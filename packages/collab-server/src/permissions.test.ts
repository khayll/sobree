/**
 * Phase 3.3 — read-only peers and leader-election session signaling.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import { SobreeCollabServer } from "./server";
import { memoryPersistence } from "./persistence";
import {
  MESSAGE_AWARENESS,
  MESSAGE_SESSION,
  MESSAGE_SYNC,
  decodeSessionMessage,
  type SessionPayload,
} from "./protocol";

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

      // Try to insert something. The local Y.Doc updates and sends a
      // sync-update message; the server drops it.
      peer.ydoc.getArray("body").insert(0, ["should-be-dropped"]);

      // Give the server time to process (or, in this case, NOT process).
      await delay(100);

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
        return role === "viewer"
          ? { allow: true, write: false }
          : { allow: true, write: true };
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
        await waitFor(
          () => viewerPeer.ydoc.getArray("body").length > 0,
          1000,
        );
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

  // Attach the message listener BEFORE awaiting `open` — otherwise
  // messages the server sends immediately on connect (in our case,
  // the session message) arrive before the handler is wired and
  // get dropped by ws.
  ws.on("message", (data) => {
    const buf =
      data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
    const decoder = decoding.createDecoder(buf);
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SESSION) {
      const session = decodeSessionMessage(decoder);
      sessionResolver?.(session);
      sessionResolver = null;
    } else if (type === MESSAGE_SYNC) {
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, reply, ydoc, "server");
      if (encoding.length(reply) > 1) {
        ws.send(encoding.toUint8Array(reply), { binary: true });
      }
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
  };
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createServer } = require("node:net");
    const srv = createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      const port =
        typeof addr === "object" && addr ? (addr as { port: number }).port : 0;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function waitFor(
  pred: () => boolean,
  timeoutMs: number,
  pollMs = 10,
): Promise<void> {
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
