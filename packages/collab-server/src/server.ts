/**
 * SobreeCollabServer — y-protocol relay + persister.
 *
 * One process can host many rooms; one room is one Y.Doc shared by N
 * peers. The server speaks pure y-protocol — it doesn't know about
 * Sobree's editor, AST, or DOCX format.
 *
 * # Usage
 *
 * ```ts
 * import { SobreeCollabServer, filesystemPersistence } from "@sobree/collab-server";
 *
 * const server = new SobreeCollabServer({
 *   port: 1234,
 *   persistence: filesystemPersistence({ dir: "./data" }),
 *   resolveRoomId: (req) => new URL(req.url ?? "", "http://x").pathname.slice(1),
 *   onConnection: async (peer) => {
 *     // Optional auth gate. Return `false` to reject.
 *     return true;
 *   },
 * });
 * await server.listen();
 * ```
 *
 * # Performance
 *
 * Rooms are kept in memory while active. Y updates are persisted
 * after a debounce (default 2s) to amortize disk writes. On graceful
 * shutdown, every active room is flushed to persistence before the
 * process exits.
 */

import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import * as encoding from "lib0/encoding";
import { encodeAwarenessUpdate } from "y-protocols/awareness";
import { Room, type RoomOptions } from "./room";
import type { Persistence } from "./persistence";
import {
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  decodeMessageHeader,
  encodeAwarenessMessage,
  encodeSessionMessage,
  encodeSyncStep1,
  readSyncMessage,
} from "./protocol";
import * as decoding from "lib0/decoding";

export interface PeerInfo {
  /** The WebSocket connection. */
  ws: WebSocket;
  /** The incoming HTTP upgrade request — for headers / cookies / IP. */
  req: IncomingMessage;
  /** Room id this peer is joining. Resolved via `resolveRoomId`. */
  roomId: string;
}

/**
 * Result of the `onConnection` hook — accept or reject the peer, and
 * if accepting, optionally restrict to read-only.
 *
 * `boolean` shorthand: `true` = accept with full read/write,
 * `false` = reject. Equivalent to `{ allow: true, write: true }` and
 * `{ allow: false }` respectively.
 */
export type ConnectionDecision =
  | boolean
  | {
      /** Whether to accept the connection at all. */
      allow: boolean;
      /** Whether the peer can mutate the document. Defaults to
       *  `true` when `allow: true`. Read-only peers see updates and
       *  can publish awareness, but their Y sync-update messages
       *  are dropped server-side. */
      write?: boolean;
    };

export interface CollabServerOptions {
  /** Port to listen on. */
  port: number;
  /** Bind host. Defaults to `0.0.0.0`. */
  host?: string;
  /** Persistence backend. Optional — without it, rooms vanish on
   *  process restart. */
  persistence?: Persistence;
  /**
   * Map an incoming WebSocket upgrade to a room id. Default: the
   * URL pathname (with leading `/` stripped). Override for
   * sub-app routing, room-key derivation from auth, etc.
   */
  resolveRoomId?: (req: IncomingMessage) => string;
  /**
   * Per-connection auth gate. Called after WebSocket upgrade but
   * before the peer is added to the room. Return `false` (or
   * `{ allow: false }`) to reject; the WebSocket is closed with
   * code 1008. Return `{ allow: true, write: false }` to accept the
   * peer as read-only.
   */
  onConnection?: (
    peer: PeerInfo,
  ) => ConnectionDecision | Promise<ConnectionDecision>;
  /**
   * Per-room overrides (forwarded to `Room`). Useful for adjusting
   * the empty-room TTL.
   */
  roomOptions?: Omit<RoomOptions, "id" | "persistence">;
  /** Debounce ms for persistence writes after Y updates. Default 2000. */
  persistDebounceMs?: number;
}

export class SobreeCollabServer {
  private readonly opts: CollabServerOptions;
  private wss: WebSocketServer | null = null;
  private readonly rooms = new Map<string, Room>();
  private readonly pendingPersist = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(opts: CollabServerOptions) {
    this.opts = opts;
  }

  /** Start listening. Resolves once the underlying WebSocketServer
   *  has bound the port (or rejects if the bind fails). */
  async listen(): Promise<void> {
    if (this.wss) throw new Error("server already listening");
    const wss = new WebSocketServer({
      port: this.opts.port,
      host: this.opts.host ?? "0.0.0.0",
    });
    this.wss = wss;
    wss.on("connection", (ws, req) => {
      void this.handleConnection(ws, req);
    });
    await new Promise<void>((resolve, reject) => {
      wss.once("listening", () => resolve());
      wss.once("error", reject);
    });
  }

  /**
   * Gracefully shut down. Closes all peer sockets, flushes every
   * room's state to persistence, then closes the WebSocketServer.
   */
  async close(): Promise<void> {
    const wss = this.wss;
    if (!wss) return;
    // Cancel pending persists; we'll flush synchronously next.
    for (const [, timer] of this.pendingPersist) clearTimeout(timer);
    this.pendingPersist.clear();
    // Persist every room.
    const persists: Promise<void>[] = [];
    for (const room of this.rooms.values()) {
      persists.push(room.destroy());
    }
    await Promise.allSettled(persists);
    this.rooms.clear();
    // Close all connections.
    for (const ws of wss.clients) {
      try {
        ws.close(1001, "server shutting down");
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
    this.wss = null;
  }

  /** Number of currently-active rooms. */
  roomCount(): number {
    return this.rooms.size;
  }

  /** Look up a live room. Returns `undefined` if no peers are
   *  currently connected to it. */
  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  // === connection handling ===

  private async handleConnection(
    ws: WebSocket,
    req: IncomingMessage,
  ): Promise<void> {
    const roomId = (this.opts.resolveRoomId ?? defaultResolveRoomId)(req);
    if (!roomId) {
      ws.close(1003, "missing room id");
      return;
    }

    let writable = true;
    if (this.opts.onConnection) {
      const decision = await this.opts.onConnection({ ws, req, roomId });
      const accept =
        typeof decision === "boolean" ? decision : decision.allow;
      if (!accept) {
        ws.close(1008, "rejected by onConnection");
        return;
      }
      if (typeof decision === "object") {
        writable = decision.write ?? true;
      }
    }

    // Get or create the room.
    let room = this.rooms.get(roomId);
    if (!room) {
      const roomOpts: RoomOptions = {
        id: roomId,
        ...(this.opts.persistence ? { persistence: this.opts.persistence } : {}),
        ...this.opts.roomOptions,
      };
      room = new Room(roomOpts);
      this.rooms.set(roomId, room);
      try {
        await room.loadFromPersistence();
      } catch (err) {
        console.error(`[collab-server] failed to load room ${roomId}:`, err);
      }
    }

    // Snapshot whether the room was empty BEFORE adding this peer
    // (so a fresh peer joining a brand-new room knows it can seed
    // initialDocument). isEmpty() considers Y.Doc body length only.
    const roomWasEmpty = room.isEmpty();
    const peerCountBefore = room.peers.size;

    room.addPeer(ws, writable);

    // Send the session message FIRST so clients have the
    // is-empty / is-writable signal before any sync messages arrive.
    safeSend(
      ws,
      encodeSessionMessage({
        isEmpty: roomWasEmpty,
        isWritable: writable,
        peerCount: peerCountBefore,
      }),
    );

    // Send initial state: sync-step-1 (asks the peer for their state
    // vector) + the current awareness map.
    const step1 = encodeSyncStep1(room.ydoc);
    safeSend(ws, step1);
    const awarenessIds = [...room.awareness.getStates().keys()];
    if (awarenessIds.length > 0) {
      const aw = encodeAwarenessUpdate(room.awareness, awarenessIds);
      safeSend(ws, encodeAwarenessMessage(aw));
    }

    // Wire up incoming messages.
    ws.on("message", (data) => {
      const buf = toUint8(data);
      this.handleMessage(room!, ws, buf);
    });

    ws.on("close", () => {
      room?.removePeer(ws);
      if (room && room.peers.size === 0) {
        // The Room's destroy timer handles eventual cleanup; we just
        // make sure our map entry is dropped after persist completes.
        this.scheduleRoomReap(roomId);
      }
    });

    ws.on("error", (err) => {
      console.warn(`[collab-server] peer error (room=${roomId}):`, err);
    });

    // Set up a Y observer to broadcast Y updates to other peers.
    // We attach it on first peer join; subsequent joins reuse it.
    if (!(room as Room & { _broadcastAttached?: boolean })._broadcastAttached) {
      (room as Room & { _broadcastAttached: boolean })._broadcastAttached = true;
      room.ydoc.on("update", (update: Uint8Array, origin: unknown) => {
        // Don't echo back to the originator if we have its socket
        // reference; otherwise broadcast to everyone.
        const msg = encodeSyncMessageUpdate(update);
        const exclude = origin instanceof Object ? (origin as WebSocket) : null;
        for (const peer of room!.peers.keys()) {
          if (peer === exclude) continue;
          safeSend(peer, msg);
        }
        // Schedule a debounced persist.
        this.schedulePersist(room!);
      });
      room.awareness.on(
        "update",
        (
          changes: { added: number[]; updated: number[]; removed: number[] },
          origin: unknown,
        ) => {
          const changed = [...changes.added, ...changes.updated, ...changes.removed];
          if (changed.length === 0) return;
          const aw = encodeAwarenessUpdate(room!.awareness, changed);
          const msg = encodeAwarenessMessage(aw);
          const exclude = origin instanceof Object ? (origin as WebSocket) : null;
          for (const peer of room!.peers.keys()) {
            if (peer === exclude) continue;
            safeSend(peer, msg);
          }
        },
      );
    }
  }

  private handleMessage(room: Room, ws: WebSocket, data: Uint8Array): void {
    let header: ReturnType<typeof decodeMessageHeader>;
    try {
      header = decodeMessageHeader(data);
    } catch (err) {
      console.warn(`[collab-server] bad message header (room=${room.id}):`, err);
      return;
    }
    if (header.type === MESSAGE_SYNC) {
      // Read-only peers: drop sync-update sub-messages but still
      // honor sync-step-1 (which requests state from the server).
      // Sync messages start with a sub-type uvarint: 0 / 1 / 2 for
      // step1 / step2 / update respectively. We peek at the sub-type
      // to enforce the policy without re-implementing the whole
      // sync protocol.
      const writable = room.isPeerWritable(ws);
      if (!writable) {
        // Clone the decoder so the peek doesn't consume the byte
        // for the downstream readSyncMessage call.
        const peekDecoder = decoding.createDecoder(
          header.decoder.arr.slice(header.decoder.pos),
        );
        const subType = decoding.readVarUint(peekDecoder);
        if (subType === 2) {
          // Sync-update from a read-only peer — drop silently. The
          // peer is allowed to receive updates from the server but
          // can't push their own.
          return;
        }
      }
      const reply = readSyncMessage(room.ydoc, ws, header.decoder);
      if (reply) safeSend(ws, reply);
      return;
    }
    if (header.type === MESSAGE_AWARENESS) {
      // Awareness flows in both directions for read-only peers —
      // they may have a cursor to show even though they can't edit.
      const awUpdate = decoding.readVarUint8Array(header.decoder);
      room.applyAwarenessUpdate(ws, awUpdate);
      return;
    }
    // Unknown message type — log and drop. Reserved type 3 lands in
    // Phase 3.2 (assets).
    console.warn(
      `[collab-server] unknown message type ${header.type} (room=${room.id})`,
    );
  }

  // === persistence + reaping ===

  private schedulePersist(room: Room): void {
    const id = room.id;
    const existing = this.pendingPersist.get(id);
    if (existing) clearTimeout(existing);
    const debounce = this.opts.persistDebounceMs ?? 2000;
    const t = setTimeout(() => {
      this.pendingPersist.delete(id);
      // Only persist if the room is still alive.
      const live = this.rooms.get(id);
      if (!live) return;
      void live.persist().catch((err) => {
        console.error(`[collab-server] persist failed for room ${id}:`, err);
      });
    }, debounce);
    (t as { unref?: () => void }).unref?.();
    this.pendingPersist.set(id, t);
  }

  private scheduleRoomReap(id: string): void {
    // After the Room's own empty TTL, drop our map entry. We use the
    // Room's destroy event indirectly: poll briefly.
    setTimeout(() => {
      const room = this.rooms.get(id);
      if (room && room.peers.size === 0) {
        this.rooms.delete(id);
      }
    }, (this.opts.roomOptions?.emptyTtlMs ?? 30000) + 1000).unref?.();
  }
}

// === helpers ===

function defaultResolveRoomId(req: IncomingMessage): string {
  const url = req.url ?? "/";
  const path = url.split("?")[0] ?? "/";
  return path.startsWith("/") ? path.slice(1) : path;
}

function safeSend(ws: WebSocket, data: Uint8Array): void {
  try {
    if (ws.readyState === ws.OPEN) {
      ws.send(data, { binary: true });
    }
  } catch (err) {
    console.warn("[collab-server] send failed:", err);
  }
}

function toUint8(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) {
    // Multi-frame messages from ws come as Buffer[].
    const len = data.reduce(
      (acc, buf) => acc + (buf as ArrayBufferView).byteLength,
      0,
    );
    const out = new Uint8Array(len);
    let off = 0;
    for (const buf of data) {
      const view = buf as ArrayBufferView;
      out.set(
        new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
        off,
      );
      off += view.byteLength;
    }
    return out;
  }
  // Node Buffer is a Uint8Array subclass.
  return new Uint8Array(data as Buffer);
}

function encodeSyncMessageUpdate(update: Uint8Array): Uint8Array {
  // Inlined to avoid the import-cycle vs protocol.ts that would arise
  // if we re-imported `encodeSyncUpdate` here. Same shape.
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeVarUint(encoder, 2); // sync sub-type "update"
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}
