import * as Y from "yjs";
import type { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Room } from "./room";
import { memoryPersistence } from "./persistence";

describe("Room", () => {
  let room: Room;

  beforeEach(() => {
    room = new Room({ id: "r" });
  });

  afterEach(async () => {
    await room.destroy();
  });

  it("starts with an empty Y.Doc", () => {
    expect(room.ydoc.getArray("body").length).toBe(0);
  });

  it("loadFromPersistence is a no-op when no persistence is set", async () => {
    await room.loadFromPersistence();
    expect(room.ydoc.getArray("body").length).toBe(0);
  });

  it("loadFromPersistence hydrates the Y.Doc when persistence has data", async () => {
    const p = memoryPersistence();
    // Pre-seed: build a separate Y.Doc, encode its state, save.
    const seed = new Y.Doc();
    seed.getArray("body").insert(0, ["hello"]);
    await p.save("r2", Y.encodeStateAsUpdate(seed));
    seed.destroy();

    const hydrated = new Room({ id: "r2", persistence: p });
    await hydrated.loadFromPersistence();
    expect(hydrated.ydoc.getArray("body").length).toBe(1);
    expect(hydrated.ydoc.getArray("body").get(0)).toBe("hello");
    await hydrated.destroy();
  });

  it("persist round-trips through a memory backend", async () => {
    const p = memoryPersistence();
    const r = new Room({ id: "r3", persistence: p });
    r.ydoc.getArray("body").insert(0, ["one", "two"]);
    await r.persist();
    const loaded = await p.load("r3");
    expect(loaded).toBeTruthy();
    // Re-apply and verify.
    const r2 = new Room({ id: "r3", persistence: p });
    await r2.loadFromPersistence();
    expect(r2.ydoc.getArray("body").length).toBe(2);
    expect(r2.ydoc.getArray("body").toArray()).toEqual(["one", "two"]);
    await r.destroy();
    await r2.destroy();
  });

  it("addPeer / removePeer tracks peers", () => {
    const ws1 = mockWs();
    const ws2 = mockWs();
    room.addPeer(ws1);
    room.addPeer(ws2);
    expect(room.peers.size).toBe(2);
    room.removePeer(ws1);
    expect(room.peers.size).toBe(1);
  });

  it("applyYUpdate updates the Y.Doc and returns the update bytes", () => {
    const peer = mockWs();
    room.addPeer(peer);
    // Build an update from a separate Y.Doc.
    const src = new Y.Doc();
    src.getArray("body").insert(0, ["x"]);
    const update = Y.encodeStateAsUpdate(src);
    src.destroy();

    const returned = room.applyYUpdate(peer, update);
    expect(returned).toBe(update);
    expect(room.ydoc.getArray("body").length).toBe(1);
  });

  it("destroy persists the final state", async () => {
    const p = memoryPersistence();
    const r = new Room({ id: "rD", persistence: p });
    r.ydoc.getArray("body").insert(0, ["last"]);
    await r.destroy();
    const loaded = await p.load("rD");
    expect(loaded).toBeTruthy();
  });

  it("destroy is idempotent", async () => {
    const r = new Room({ id: "idem" });
    await r.destroy();
    await r.destroy();
  });

  it("otherPeers excludes the given socket", () => {
    const a = mockWs();
    const b = mockWs();
    const c = mockWs();
    room.addPeer(a);
    room.addPeer(b);
    room.addPeer(c);
    expect(room.otherPeers(b)).toEqual([a, c]);
  });
});

// Minimal WebSocket-shape stub for non-protocol tests. We only need
// `Room` to treat it as an opaque key in its peers map; the cast here
// satisfies the WebSocket parameter type without pulling in the full
// `ws` API surface.
function mockWs(): WebSocket {
  return { _id: Math.random() } as unknown as WebSocket;
}
