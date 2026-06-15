/**
 * Phase 3.3 — read-only peers and leader-election session signaling.
 */

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { memoryPersistence } from "./persistence";
import {
  MESSAGE_AWARENESS,
  MESSAGE_SESSION,
  MESSAGE_SYNC,
  type SessionPayload,
  decodeSessionMessage,
} from "./protocol";
import { SobreeCollabServer } from "./server";

describe("Phase 3.3 — session message + read-only peers", () => {
  let server: SobreeCollabServer;
  let port: number;

  beforeEach(async () => {
    port = await findFreePort();
  });

  afterEach(async () => {
    if (server) await server.close();
  });

  it("first peer in a fresh room receives a session with isEmpty=true", async () => {
    server = new SobreeCollabServer({
      port,
      persistence: memoryPersistence(),
      roomOptions: { emptyTtlMs: 50 },
    });
    await server.listen();

    const peer = await connect(`ws://127.0.0.1:${port}/fresh-room`);
    try {
      const session = await peer.awaitSession();
      expect(session.isEmpty).toBe(true);
      expect(session.isWritable).toBe(true);
      expect(session.peerCount).toBe(0);
    } finally {
      peer.close();
    }
  });

  it("second peer joining a non-empty room receives isEmpty=false", async () => {
    server = new SobreeCollabServer({
      port,
      persistence: memoryPersistence(),
      roomOptions: { emptyTtlMs: 50 },
    });
    await server.listen();

    const url = `ws://127.0.0.1:${port}/two-peers`;
    const peerA = await connect(url);
    try {
      // Have peer A insert something so the room is non-empty.
      const sessionA = await peerA.awaitSession();
      expect(sessionA.isEmpty).toBe(true);
      peerA.ydoc.getArray("body").insert(0, ["hello"]);
      // Wait for the server-side room to reflect the insert.
      await waitFor(() => {
        const r = server.getRoom("two-peers");
        return r ? r.ydoc.getArray("body").length > 0 : false;
      }, 1000);

      const peerB = await connect(url);
      try {
        const sessionB = await peerB.awaitSession();
        expect(sessionB.isEmpty).toBe(false);
        expect(sessionB.peerCount).toBeGreaterThanOrEqual(1);
      } finally {
        peerB.close();
      }
    } finally {
      peerA.close();
    }
  });

  it("read-only peer's sync-update messages are dropped server-side", async () => {
    server = new SobreeCollabServer({
      port,
      persistence: memoryPersistence(),
      roomOptions: { emptyTtlMs: 50 },
      onConnection: ({ roomId }) => {
        // Read-only for one specific room id.
        if (roomId === "readonly-room") return { allow: true, write: false };
        return true;
      },
    });
    await server.listen();

    const peer = await connect(`ws://127.0.0.1:${port}/readonly-room`);
    try {
      const session = await peer.awaitSession();
      expect(session.isWritable).toBe(false);

      // Wait for the initial sync handshake to settle BEFORE mutating.
      // Otherwise our reply to the server's sync-step-1 would carry the
      // insert as a sync-step-2 (which the server applies — only
      // sync-*update* sub-messages are dropped for read-only peers),
      // and the assertion below would race the handshake.
      await peer.awaitSynced();

      // Try to insert something. The local Y.Doc updates and sends a
      // sync-update message; the server drops it.
      peer.ydoc.getArray("body").insert(0, ["should-be-dropped"]);

      // Deterministically flush the relay: a sync round-trip whose reply
      // we await. WebSocket preserves message order, so once the reply
      // lands the server has already processed (and dropped) the
      // sync-update sent just above — no timing guess needed.
      await peer.flush();

      // The server-side room should NOT have the insert.
      const room = server.getRoom("readonly-room");
      expect(room).toBeDefined();
      expect(room?.ydoc.getArray("body").length).toBe(0);
    } finally {
      peer.close();
    }
  });

  it("read-only peer still receives updates from other peers", async () => {
    server = new SobreeCollabServer({
      port,
      persistence: memoryPersistence(),
      roomOptions: { emptyTtlMs: 50 },
      onConnection: ({ req }) => {
        // Use a URL query parameter to differentiate "viewer" from
        // "editor" in this test. Not real auth.
        const u = new URL(req.url ?? "", "http://x");
        const role = u.searchParams.get("role");
        return role === "viewer" ? { allow: true, write: false } : { allow: true, write: true };
      },
    });
    await server.listen();

    const baseUrl = `ws://127.0.0.1:${port}/mixed-room`;
    const editorPeer = await connect(`${baseUrl}?role=editor`);
    try {
      await editorPeer.awaitSession();
      const viewerPeer = await connect(`${baseUrl}?role=viewer`);
      try {
        const viewerSession = await viewerPeer.awaitSession();
        expect(viewerSession.isWritable).toBe(false);

        // Editor inserts.
        editorPeer.ydoc.getArray("body").insert(0, ["from-editor"]);

        // Viewer receives via Y sync push.
        await waitFor(() => viewerPeer.ydoc.getArray("body").length > 0, 1000);
        expect(viewerPeer.ydoc.getArray("body").get(0)).toBe("from-editor");
      } finally {
        viewerPeer.close();
      }
    } finally {
      editorPeer.close();
    }
  });

  it("rejected connection (allow=false) closes the WebSocket", async () => {
    server = new SobreeCollabServer({
      port,
      onConnection: () => ({ allow: false }),
      roomOptions: { emptyTtlMs: 50 },
    });
    await server.listen();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/rejected`);
    await new Promise<void>((resolve) => {
      ws.on("close", () => resolve());
      ws.on("error", () => resolve());
    });
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });
});

// === client harness ===

interface TestPeer {
  ws: WebSocket;
  ydoc: Y.Doc;
  close: () => void;
  awaitSession: () => Promise<SessionPayload>;
  /** Resolves once we've replied to the server's initial sync-step-1,
   *  i.e. our half of the sync handshake is on the wire. After this,
   *  local mutations only ever reach the server as sync-*update*
   *  sub-messages — never folded into a step-2 reply. */
  awaitSynced: () => Promise<void>;
  /** Round-trip the relay: send a sync-step-1 and resolve when its
   *  reply arrives. Because WebSocket preserves order, any message we
   *  sent earlier has been processed by the server by then. */
  flush: () => Promise<void>;
}

async function connect(url: string): Promise<TestPeer> {
  const ws = new WebSocket(url);
  return wrapConnection(ws);
}

async function wrapConnection(ws: WebSocket): Promise<TestPeer> {
  const ydoc = new Y.Doc();

  let sessionResolver: ((p: SessionPayload) => void) | null = null;
  const sessionPromise = new Promise<SessionPayload>((resolve) => {
    sessionResolver = resolve;
  });

  // Resolves the first time we reply to a server sync-step-1.
  let syncedResolver: (() => void) | null = null;
  const syncedPromise = new Promise<void>((resolve) => {
    syncedResolver = resolve;
  });

  // FIFO of pending `flush()` waiters, each resolved by the next
  // inbound sync message (the reply to a flush's sync-step-1).
  const flushWaiters: Array<() => void> = [];

  // Sub-message tags within a MESSAGE_SYNC envelope (y-protocols/sync):
  // 0 = sync-step-1, 1 = sync-step-2, 2 = update.
  const SYNC_STEP_1 = 0;

  // Attach the message listener BEFORE awaiting `open` — otherwise
  // messages the server sends immediately on connect (in our case,
  // the session message) arrive before the handler is wired and
  // get dropped by ws.
  ws.on("message", (data) => {
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
    const decoder = decoding.createDecoder(buf);
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SESSION) {
      const session = decodeSessionMessage(decoder);
      sessionResolver?.(session);
      sessionResolver = null;
    } else if (type === MESSAGE_SYNC) {
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      const subType = syncProtocol.readSyncMessage(decoder, reply, ydoc, "server");
      if (encoding.length(reply) > 1) {
        ws.send(encoding.toUint8Array(reply), { binary: true });
      }
      // Replying to the server's initial sync-step-1 means our state
      // (empty, at handshake time) is now on the wire ahead of any
      // later mutation. Signal that the handshake half is settled.
      if (subType === SYNC_STEP_1) {
        syncedResolver?.();
        syncedResolver = null;
      }
      // Release one pending flush waiter (the reply to its step-1).
      flushWaiters.shift()?.();
    } else if (type === MESSAGE_AWARENESS) {
      // Ignore in this test set.
    }
  });

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  // Forward local updates as sync-update messages.
  ydoc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === "server") return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    encoding.writeVarUint(enc, 2); // sync-update
    encoding.writeVarUint8Array(enc, update);
    ws.send(encoding.toUint8Array(enc), { binary: true });
  });

  // Send our own sync-step-1 to ask the server for state.
  {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, ydoc);
    ws.send(encoding.toUint8Array(enc), { binary: true });
  }

  return {
    ws,
    ydoc,
    close: () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      ydoc.destroy();
    },
    awaitSession: () => sessionPromise,
    awaitSynced: () => syncedPromise,
    flush: () =>
      new Promise<void>((resolve) => {
        flushWaiters.push(resolve);
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.writeSyncStep1(enc, ydoc);
        ws.send(encoding.toUint8Array(enc), { binary: true });
      }),
  };
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createServer } = require("node:net");
    const srv = createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? (addr as { port: number }).port : 0;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function waitFor(pred: () => boolean, timeoutMs: number, pollMs = 10): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor: timeout after ${timeoutMs}ms`);
    }
    await delay(pollMs);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
