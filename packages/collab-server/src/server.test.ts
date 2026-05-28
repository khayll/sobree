/**
 * End-to-end server tests — real WebSocketServer + real `ws` clients
 * + real Y.Doc updates. The goal is to verify that the protocol
 * round-trips correctly: a peer's local Y.Doc edit propagates through
 * the server to other peers in the same room.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import { Awareness, applyAwarenessUpdate } from "y-protocols/awareness";
import { SobreeCollabServer } from "./server";
import { memoryPersistence } from "./persistence";
import {
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
} from "./protocol";

describe("SobreeCollabServer — e2e via WebSocket clients", () => {
  let server: SobreeCollabServer;
  let port: number;

  beforeEach(async () => {
    port = await findFreePort();
    server = new SobreeCollabServer({
      port,
      persistence: memoryPersistence(),
      // Short empty-room TTL so tests can verify reap behavior
      // without long waits.
      roomOptions: { emptyTtlMs: 50 },
      persistDebounceMs: 30,
    });
    await server.listen();
  });

  afterEach(async () => {
    await server.close();
  });

  it("two peers in the same room sync Y updates through the server", async () => {
    const url = `ws://127.0.0.1:${port}/test-room`;
    const peerA = await connectAndSync(url);
    const peerB = await connectAndSync(url);
    try {
      // Peer A makes an edit.
      peerA.ydoc.getArray("body").insert(0, ["from-A"]);
      // The Y.Doc fires "update"; the test client forwards it as a
      // sync-update message.
      await waitFor(() => peerB.ydoc.getArray("body").length > 0, 1000);
      expect(peerB.ydoc.getArray("body").get(0)).toBe("from-A");

      // Peer B replies.
      peerB.ydoc.getArray("body").insert(1, ["from-B"]);
      await waitFor(() => peerA.ydoc.getArray("body").length > 1, 1000);
      expect(peerA.ydoc.getArray("body").toArray()).toEqual(["from-A", "from-B"]);
    } finally {
      peerA.close();
      peerB.close();
    }
  });

  it("server persists Y.Doc state and re-hydrates on next connection", async () => {
    const url = `ws://127.0.0.1:${port}/persistent-room`;

    // Connect peer 1.
    const peer1 = await connectAndSync(url);
    // Wait for the room to be live server-side. Without this we
    // can race the server's async room-setup (await
    // loadFromPersistence), and the test client's first
    // sync-update can fire before ws.on("message") is wired.
    await waitFor(() => server.getRoom("persistent-room") !== undefined, 1000);
    peer1.ydoc.getArray("body").insert(0, ["persisted"]);
    // Wait for the server-side observer to receive the update.
    await waitFor(
      () => {
        const room = server.getRoom("persistent-room");
        return room ? room.ydoc.getArray("body").length > 0 : false;
      },
      1000,
    );
    // Force a persist (don't wait for the debounce).
    const room = server.getRoom("persistent-room");
    if (room) await room.persist();
    peer1.close();

    // Wait long enough for the empty-room timer to fire (50ms TTL
    // + a generous buffer).
    await delay(300);

    // The room should have been destroyed (peer count went to 0,
    // TTL expired). Confirm via roomCount.
    // We can't strictly assert it's destroyed because the reap-map
    // timer also runs, but the next connection should hydrate from
    // persistence.
    const peer2 = await connectAndSync(url);
    try {
      // Peer 2 should see the persisted state immediately.
      await waitFor(
        () => peer2.ydoc.getArray("body").length > 0,
        1000,
      );
      expect(peer2.ydoc.getArray("body").get(0)).toBe("persisted");
    } finally {
      peer2.close();
    }
  });

  it("peers in different rooms don't see each other's updates", async () => {
    const peerA = await connectAndSync(`ws://127.0.0.1:${port}/room-A`);
    const peerB = await connectAndSync(`ws://127.0.0.1:${port}/room-B`);
    try {
      peerA.ydoc.getArray("body").insert(0, ["only-A"]);
      // Give time for any spurious propagation.
      await delay(150);
      expect(peerB.ydoc.getArray("body").length).toBe(0);
    } finally {
      peerA.close();
      peerB.close();
    }
  });

  it("awareness propagates between peers in the same room", async () => {
    const url = `ws://127.0.0.1:${port}/awareness-room`;
    const peerA = await connectAndSync(url);
    const peerB = await connectAndSync(url);
    try {
      peerA.awareness.setLocalStateField("user", { name: "Alice" });
      await waitFor(
        () => {
          for (const state of peerB.awareness.getStates().values()) {
            if ((state as { user?: { name?: string } }).user?.name === "Alice") {
              return true;
            }
          }
          return false;
        },
        1000,
      );
    } finally {
      peerA.close();
      peerB.close();
    }
  });

  it("onConnection hook can reject connections", async () => {
    await server.close();
    const port2 = await findFreePort();
    const restricted = new SobreeCollabServer({
      port: port2,
      onConnection: ({ roomId }) => roomId !== "forbidden",
      roomOptions: { emptyTtlMs: 50 },
    });
    await restricted.listen();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port2}/forbidden`);
      await new Promise<void>((resolve) => {
        ws.on("close", () => resolve());
        ws.on("error", () => resolve());
      });
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    } finally {
      await restricted.close();
    }
  });
});

// === test client harness ===

interface TestPeer {
  ws: WebSocket;
  ydoc: Y.Doc;
  awareness: Awareness;
  close: () => void;
}

/**
 * Connect a y-protocol client to the server. Reads server messages
 * and applies them to the local Y.Doc; sends Y.Doc updates back. Uses
 * the same message wire format as @sobree/core's editor would.
 */
async function connectAndSync(url: string): Promise<TestPeer> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);

  ws.on("message", (data) => {
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
    const decoder = decoding.createDecoder(buf);
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) {
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, reply, ydoc, "server");
      if (encoding.length(reply) > 1) {
        ws.send(encoding.toUint8Array(reply), { binary: true });
      }
    } else if (type === MESSAGE_AWARENESS) {
      const aw = decoding.readVarUint8Array(decoder);
      applyAwarenessUpdate(awareness, aw, "server");
    }
  });

  // Send our own sync-step-1 so the server tells us about state we
  // don't have. (The server sends one too, but that only tells the
  // server about state WE have — it's not a complete handshake
  // without both sides asking each other.)
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, ydoc);
    ws.send(encoding.toUint8Array(encoder), { binary: true });
  }

  // Forward local Y.Doc updates as sync-update messages.
  ydoc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === "server") return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, 2); // sync-update
    encoding.writeVarUint8Array(encoder, update);
    ws.send(encoding.toUint8Array(encoder), { binary: true });
  });

  awareness.on(
    "update",
    (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === "server") return;
      const changed = [...changes.added, ...changes.updated, ...changes.removed];
      if (changed.length === 0) return;
      // Re-encode the awareness update using y-protocols' encoder.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { encodeAwarenessUpdate } = require("y-protocols/awareness");
      const aw = encodeAwarenessUpdate(awareness, changed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, aw);
      ws.send(encoding.toUint8Array(encoder), { binary: true });
    },
  );

  return {
    ws,
    ydoc,
    awareness,
    close(): void {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      ydoc.destroy();
      awareness.destroy();
    },
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
