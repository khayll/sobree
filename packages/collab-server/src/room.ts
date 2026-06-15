/**
 * One Y.Doc shared by N peers — the unit of collaboration.
 *
 * # Lifecycle
 *
 *   1. First peer joins → room is created, Y.Doc allocated, persisted
 *      state (if any) loaded into the Y.Doc.
 *   2. Subsequent peers join → they receive a sync-step-1 from the
 *      server (representing the current Y.Doc state) and reply with
 *      their own state diffs. Y handles convergence.
 *   3. Any peer's incoming update is applied to the room's Y.Doc and
 *      broadcast to every other peer in the room.
 *   4. Awareness messages (cursors, presence) are broadcast as-is
 *      without touching the Y.Doc.
 *   5. When the last peer leaves, the room is **kept alive** for a
 *      grace period (default 30s) so reconnecting clients pick up the
 *      same state. After the grace period, the room is destroyed and
 *      its final state persisted.
 *
 * # No editor inside
 *
 * The server never instantiates an `Editor`. It doesn't know about
 * paragraphs, marks, or DOCX. It speaks pure y-protocol: opaque binary
 * updates and awareness blobs. This is the load-bearing simplification
 * that lets one Node process host thousands of rooms.
 */

import type { WebSocket } from "ws";
import { Awareness, removeAwarenessStates } from "y-protocols/awareness";
import * as Y from "yjs";
import type { Persistence } from "./persistence";

export interface RoomOptions {
  /** Stable id for the room. Forms part of the persistence key. */
  id: string;
  /** Persistence backend — load on init, save on shutdown / interval. */
  persistence?: Persistence;
  /** Grace period (ms) after the last peer leaves before destroy.
   *  Default 30000 (30s). */
  emptyTtlMs?: number;
}

/**
 * Per-peer state tracked by the room: the peer's awareness clientID
 * (once known) and their granted write permission. Read-only peers
 * have their incoming Y sync-update messages dropped server-side.
 */
export interface PeerState {
  /** Awareness clientID, or `-1` until first awareness state arrives. */
  clientId: number;
  /** Whether the server will accept Y sync-update messages from
   *  this peer. */
  writable: boolean;
}

export class Room {
  readonly id: string;
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  /** Connected peers, keyed by their WebSocket reference. */
  readonly peers: Map<WebSocket, PeerState> = new Map();

  private readonly persistence: Persistence | undefined;
  private readonly emptyTtlMs: number;
  private destroyTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(opts: RoomOptions) {
    this.id = opts.id;
    if (opts.persistence) this.persistence = opts.persistence;
    this.emptyTtlMs = opts.emptyTtlMs ?? 30000;
    this.ydoc = new Y.Doc();
    this.awareness = new Awareness(this.ydoc);
    // The local peer (the server itself) never publishes awareness;
    // clear its slot so peers don't see a phantom "Server" cursor.
    this.awareness.setLocalState(null);
  }

  /**
   * Hydrate from persistence. Call after construction, before the
   * first peer joins. Idempotent.
   */
  async loadFromPersistence(): Promise<void> {
    if (!this.persistence) return;
    const stored = await this.persistence.load(this.id);
    if (stored && stored.length > 0) {
      Y.applyUpdate(this.ydoc, stored, "persistence");
    }
  }

  /**
   * Snapshot the current Y.Doc state to persistence. Called on
   * shutdown and on a periodic timer (managed by the server, not the
   * room — keeps this class testable without a clock).
   */
  async persist(): Promise<void> {
    if (!this.persistence) return;
    const update = Y.encodeStateAsUpdate(this.ydoc);
    await this.persistence.save(this.id, update);
  }

  /**
   * Register a peer.
   *
   * `writable` defaults to true (full read/write). Pass `false` for
   * read-only peers — the server will drop their incoming Y
   * sync-update messages but still forward server→peer state and
   * accept their awareness updates.
   */
  addPeer(ws: WebSocket, writable = true): void {
    this.peers.set(ws, { clientId: -1, writable });
    if (this.destroyTimer !== null) {
      clearTimeout(this.destroyTimer);
      this.destroyTimer = null;
    }
  }

  /**
   * Remove a peer. If they had an awareness state, remove it (so
   * other peers see them leave). If this leaves the room empty,
   * schedule a destroy after the grace period.
   */
  removePeer(ws: WebSocket): void {
    const state = this.peers.get(ws);
    this.peers.delete(ws);
    if (state && state.clientId >= 0) {
      removeAwarenessStates(this.awareness, [state.clientId], "peer-disconnect");
    }
    if (this.peers.size === 0) {
      this.scheduleDestroyIfStillEmpty();
    }
  }

  /** Whether the given peer is allowed to make Y sync-update edits. */
  isPeerWritable(ws: WebSocket): boolean {
    return this.peers.get(ws)?.writable ?? false;
  }

  /**
   * Cheap check for "the Y.Doc is currently empty" — used when
   * notifying a fresh peer whether they're allowed to seed
   * `initialDocument`. Considers body length only; meta and parts
   * may carry seed-time defaults from a prior peer.
   */
  isEmpty(): boolean {
    return this.ydoc.getArray("body").length === 0;
  }

  /**
   * Apply a Y update from a peer. Returns the encoded update so the
   * caller can broadcast to other peers. The update is also persisted
   * (the server batches actual disk writes with a debounce).
   */
  applyYUpdate(from: WebSocket, update: Uint8Array): Uint8Array {
    Y.applyUpdate(this.ydoc, update, from);
    return update;
  }

  /**
   * Apply an awareness update from a peer. Returns the encoded update
   * for broadcast.
   */
  applyAwarenessUpdate(from: WebSocket, update: Uint8Array): Uint8Array {
    // y-protocols/awareness's applyAwarenessUpdate accepts an opaque
    // origin and updates the awareness map. The encoded update is
    // re-broadcast verbatim — the awareness module handles diff
    // semantics.
    // Note: dynamic import to avoid pulling y-protocols/awareness
    // into all consumers' bundles unnecessarily; this file already
    // imports from y-protocols/awareness for the Awareness class.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { applyAwarenessUpdate } = require("y-protocols/awareness");
    applyAwarenessUpdate(this.awareness, update, from);
    // Track the peer's clientID once we see their first state update.
    const state = this.peers.get(from);
    if (state && state.clientId === -1) {
      // Best-effort: pick the most recently updated clientID that
      // isn't already claimed by another peer. This is a heuristic;
      // production servers may want a proper handshake.
      const claimed = new Set<number>();
      for (const peerState of this.peers.values()) {
        if (peerState.clientId >= 0) claimed.add(peerState.clientId);
      }
      for (const id of this.awareness.getStates().keys()) {
        if (id !== this.ydoc.clientID && !claimed.has(id)) {
          state.clientId = id;
          break;
        }
      }
    }
    return update;
  }

  /** All peers EXCEPT the source — for broadcast fan-out. */
  otherPeers(except: WebSocket): WebSocket[] {
    const out: WebSocket[] = [];
    for (const ws of this.peers.keys()) {
      if (ws !== except) out.push(ws);
    }
    return out;
  }

  /** All peers including the source — used for awareness broadcasts
   *  where we want the server's view to converge for everyone. */
  allPeers(): WebSocket[] {
    return [...this.peers.keys()];
  }

  /**
   * Force-destroy the room. Persists final state. Called by the
   * server on shutdown OR when the empty-room TTL expires.
   */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.destroyTimer !== null) {
      clearTimeout(this.destroyTimer);
      this.destroyTimer = null;
    }
    await this.persist();
    this.awareness.destroy();
    this.ydoc.destroy();
  }

  // === internals ===

  private scheduleDestroyIfStillEmpty(): void {
    if (this.destroyTimer !== null) clearTimeout(this.destroyTimer);
    this.destroyTimer = setTimeout(() => {
      this.destroyTimer = null;
      if (this.peers.size === 0) {
        // Fire-and-forget — caller handles errors via persistence.
        void this.destroy();
      }
    }, this.emptyTtlMs);
    // Allow the Node process to exit even with this timer pending
    // (relevant in tests). Optional chaining since `unref` exists on
    // Node Timer but not on browser timeouts.
    (this.destroyTimer as { unref?: () => void }).unref?.();
  }
}
