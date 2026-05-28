import * as Y from "yjs";
import { beforeEach, describe, expect, it } from "vitest";
import { HeadlessSobree } from "./headless";
import {
  appendBlock,
  emptyDocument,
  heading,
  paragraph,
  text,
} from "./doc/builders";

describe("HeadlessSobree — construction", () => {
  it("seeds an empty Y.Doc from initialDocument", () => {
    const ydoc = new Y.Doc();
    const initial = emptyDocument();
    appendBlock(initial, heading(1, [text("Hello")]));
    appendBlock(initial, paragraph([text("First paragraph.")]));

    const peer = new HeadlessSobree(ydoc, { initialDocument: initial });
    try {
      expect(peer.getDocument().body.length).toBe(initial.body.length);
      expect(peer.getBlocks().length).toBe(initial.body.length);
    } finally {
      peer.destroy();
    }
  });

  it("adopts an already-populated Y.Doc", () => {
    // Peer A seeds the Y.Doc.
    const ydocA = new Y.Doc();
    const initial = emptyDocument();
    appendBlock(initial, paragraph([text("seeded by A")]));
    const peerA = new HeadlessSobree(ydocA, { initialDocument: initial });

    // Peer B's Y.Doc gets a copy of A's state via Y.applyUpdate
    // (simulating a freshly-joined provider client).
    const ydocB = new Y.Doc();
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA));

    const peerB = new HeadlessSobree(ydocB);
    try {
      // B adopted A's state — no re-seed.
      expect(peerB.getDocument().body.length).toBe(
        peerA.getDocument().body.length,
      );
      // Same block ids on both sides.
      const aIds = peerA.getBlocks().map((b) => b.id);
      const bIds = peerB.getBlocks().map((b) => b.id);
      expect(bIds).toEqual(aIds);
    } finally {
      peerA.destroy();
      peerB.destroy();
    }
  });

  it("registers history.undo/redo on the command bus", () => {
    const peer = new HeadlessSobree(new Y.Doc());
    try {
      expect(peer.commands.has("history.undo")).toBe(true);
      expect(peer.commands.has("history.redo")).toBe(true);
    } finally {
      peer.destroy();
    }
  });

  it("uses ydoc.clientID-derived id prefix to avoid cross-peer collision", () => {
    const peerA = new HeadlessSobree(new Y.Doc());
    const peerB = new HeadlessSobree(new Y.Doc());
    try {
      const aId = peerA.getBlock(0).id;
      const bId = peerB.getBlock(0).id;
      // Different clientIDs → different prefixes → different ids.
      expect(aId.split("_")[0]).not.toBe(bId.split("_")[0]);
    } finally {
      peerA.destroy();
      peerB.destroy();
    }
  });
});

describe("HeadlessSobree — reads", () => {
  let peer: HeadlessSobree;

  beforeEach(() => {
    const initial = emptyDocument();
    appendBlock(initial, heading(1, [text("Title")]));
    appendBlock(initial, paragraph([text("Body 1")]));
    appendBlock(initial, paragraph([text("Body 2")]));
    peer = new HeadlessSobree(new Y.Doc(), { initialDocument: initial });
  });

  it("getBlocks returns one entry per block", () => {
    expect(peer.getBlocks().length).toBe(4);
  });

  it("getBlock(idx) returns the right kind", () => {
    expect(peer.getBlock(1).kind).toBe("paragraph");
    expect(peer.getBlock(2).text).toBe("Body 1");
  });

  it("getBlockById returns the matching block", () => {
    const block = peer.getBlock(2);
    expect(peer.getBlockById(block.id)?.text).toBe("Body 1");
    expect(peer.getBlockById("nope")).toBeNull();
  });

  it("getOutline returns heading entries only", () => {
    const outline = peer.getOutline();
    // The seeded "Title" heading at index 1; index 0 is the
    // emptyDocument's default plain paragraph.
    expect(outline.length).toBe(1);
    expect(outline[0]?.text).toBe("Title");
  });
});

describe("HeadlessSobree — mutations", () => {
  let peer: HeadlessSobree;

  beforeEach(() => {
    const initial = emptyDocument();
    appendBlock(initial, paragraph([text("first")]));
    appendBlock(initial, paragraph([text("second")]));
    peer = new HeadlessSobree(new Y.Doc(), { initialDocument: initial });
  });

  it("replaceBlock swaps content in place", () => {
    const target = peer.getBlock(1);
    const result = peer.replaceBlock(
      { id: target.id, version: target.version },
      paragraph([text("replaced")]),
    );
    expect(result.ok).toBe(true);
    expect(peer.getBlock(1).text).toBe("replaced");
  });

  it("replaceBlock rejects stale version (optimistic lock)", () => {
    const target = peer.getBlock(1);
    peer.replaceBlock(
      { id: target.id, version: target.version },
      paragraph([text("first edit")]),
    );
    // Re-using the original version is now stale.
    const result = peer.replaceBlock(
      { id: target.id, version: target.version },
      paragraph([text("should fail")]),
    );
    expect(result.ok).toBe(false);
  });

  it("insertBlockBefore + insertBlockAfter put new blocks at correct positions", () => {
    const anchor = peer.getBlock(1);
    peer.insertBlockBefore(
      { id: anchor.id, version: anchor.version },
      paragraph([text("before")]),
    );
    peer.insertBlockAfter(
      { id: anchor.id, version: anchor.version },
      paragraph([text("after")]),
    );
    const blocks = peer.getBlocks();
    // before-the-anchor, anchor, after-the-anchor
    expect(blocks[1]?.text).toBe("before");
    expect(blocks[2]?.text).toBe("first");
    expect(blocks[3]?.text).toBe("after");
  });

  it("deleteBlock removes the target", () => {
    const target = peer.getBlock(1);
    const before = peer.getDocument().body.length;
    const result = peer.deleteBlock({ id: target.id, version: target.version });
    expect(result.ok).toBe(true);
    expect(peer.getDocument().body.length).toBe(before - 1);
  });

  it("applyBlockProperties merges a paragraph properties patch", () => {
    const target = peer.getBlock(1);
    const result = peer.applyBlockProperties(
      [{ id: target.id, version: target.version }],
      { alignment: "center" },
    );
    expect(result.ok).toBe(true);
    const block = peer.getDocument().body[1];
    if (block?.kind === "paragraph") {
      expect(block.properties.alignment).toBe("center");
    } else {
      throw new Error("expected paragraph");
    }
  });

  it("setDocument replaces the doc wholesale", () => {
    const next = emptyDocument();
    appendBlock(next, paragraph([text("wiped + replaced")]));
    peer.setDocument(next);
    // emptyDocument has 1 block; we appended 1 more.
    expect(peer.getDocument().body.length).toBe(2);
  });
});

describe("HeadlessSobree — events", () => {
  it("fires change on local mutations with local=true", () => {
    const peer = new HeadlessSobree(new Y.Doc());
    try {
      const events: boolean[] = [];
      peer.on("change", (p) => events.push(p.local));
      const target = peer.getBlock(0);
      peer.replaceBlock(
        { id: target.id, version: target.version },
        paragraph([text("changed")]),
      );
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((local) => local === true)).toBe(true);
    } finally {
      peer.destroy();
    }
  });

  it("fires change on remote Y updates with local=false", () => {
    const ydocA = new Y.Doc();
    const ydocB = new Y.Doc();
    const peerA = new HeadlessSobree(ydocA);
    // Sync A → B (B adopts A's seed state).
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), "from-A");
    const peerB = new HeadlessSobree(ydocB);
    try {
      const eventsOnB: boolean[] = [];
      peerB.on("change", (p) => eventsOnB.push(p.local));

      // A mutates.
      const target = peerA.getBlock(0);
      peerA.replaceBlock(
        { id: target.id, version: target.version },
        paragraph([text("from A")]),
      );

      // Propagate to B.
      Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), "from-A");

      expect(eventsOnB.length).toBeGreaterThan(0);
      expect(eventsOnB.every((local) => local === false)).toBe(true);
    } finally {
      peerA.destroy();
      peerB.destroy();
    }
  });
});

describe("HeadlessSobree — history", () => {
  it("local mutations land on the undo stack", () => {
    const peer = new HeadlessSobree(new Y.Doc());
    try {
      expect(peer.history.canUndo()).toBe(false);
      const target = peer.getBlock(0);
      peer.replaceBlock(
        { id: target.id, version: target.version },
        paragraph([text("edit 1")]),
      );
      expect(peer.history.canUndo()).toBe(true);
    } finally {
      peer.destroy();
    }
  });

  it("undo reverses the last mutation", () => {
    const initial = emptyDocument();
    appendBlock(initial, paragraph([text("original")]));
    const peer = new HeadlessSobree(new Y.Doc(), { initialDocument: initial });
    try {
      const target = peer.getBlock(1);
      peer.replaceBlock(
        { id: target.id, version: target.version },
        paragraph([text("modified")]),
      );
      expect(peer.getBlock(1).text).toBe("modified");
      const undid = peer.history.undo();
      expect(undid).toBe(true);
      expect(peer.getBlock(1).text).toBe("original");
    } finally {
      peer.destroy();
    }
  });

  it("remote mutations don't end up on the local undo stack", () => {
    const ydocA = new Y.Doc();
    const peerA = new HeadlessSobree(ydocA, { origin: "agent-a" });
    Y.applyUpdate(ydocA, Y.encodeStateAsUpdate(ydocA)); // no-op, just for symmetry
    const ydocB = new Y.Doc();
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), "from-A");
    const peerB = new HeadlessSobree(ydocB, { origin: "agent-b" });
    try {
      // B's undo stack starts empty.
      expect(peerB.history.canUndo()).toBe(false);
      // A mutates, syncs to B.
      const targetA = peerA.getBlock(0);
      peerA.replaceBlock(
        { id: targetA.id, version: targetA.version },
        paragraph([text("A edits")]),
      );
      Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), "from-A");
      // B's undo stack is STILL empty — A's edit isn't B's to undo.
      expect(peerB.history.canUndo()).toBe(false);
    } finally {
      peerA.destroy();
      peerB.destroy();
    }
  });
});

describe("HeadlessSobree — two peers via shared Y.Doc", () => {
  it("mutations from one peer propagate to the other (when they share state)", () => {
    // The two HeadlessSobree peers are conceptually like a browser
    // editor and an LLM agent: they share the document via Y. In
    // this test we mediate the sync manually with Y.applyUpdate;
    // in production, a Y provider (websocket, webrtc, loopback)
    // would do this automatically.
    const ydocA = new Y.Doc();
    const ydocB = new Y.Doc();
    const peerA = new HeadlessSobree(ydocA, { origin: "human" });
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), "from-A");
    const peerB = new HeadlessSobree(ydocB, { origin: "llm" });
    try {
      // Concurrent edits to different blocks → both survive.
      const targetA = peerA.getBlock(0);
      peerA.replaceBlock(
        { id: targetA.id, version: targetA.version },
        paragraph([text("edit by human")]),
      );
      const targetB = peerB.getBlock(0); // same block in B's view
      peerB.insertBlockAfter(
        { id: targetB.id, version: targetB.version },
        paragraph([text("inserted by LLM")]),
      );

      // Sync both ways.
      Y.applyUpdate(ydocA, Y.encodeStateAsUpdate(ydocB), "from-B");
      Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), "from-A");

      // Both peers converge.
      expect(peerA.getDocument()).toEqual(peerB.getDocument());
      // Both edits present.
      expect(peerA.getDocument().body.length).toBe(2);
    } finally {
      peerA.destroy();
      peerB.destroy();
    }
  });
});

describe("HeadlessSobree — selection", () => {
  it("setSelection / getSelection round-trip a caret", () => {
    const peer = new HeadlessSobree(new Y.Doc());
    try {
      const block = peer.getBlock(0);
      const sel = {
        kind: "caret" as const,
        at: {
          block: { id: block.id, version: block.version },
          offset: 0,
        },
      };
      peer.setSelection(sel);
      expect(peer.getSelection()).toEqual(sel);
    } finally {
      peer.destroy();
    }
  });

  it("selection is captured + restored across undo", () => {
    const initial = emptyDocument();
    appendBlock(initial, paragraph([text("hello")]));
    const peer = new HeadlessSobree(new Y.Doc(), { initialDocument: initial });
    try {
      const block = peer.getBlock(1);
      // Pre-edit selection at offset 5.
      const preSel = {
        kind: "caret" as const,
        at: {
          block: { id: block.id, version: block.version },
          offset: 5,
        },
      };
      peer.setSelection(preSel);

      // Mutate; after the mutation, set a different selection.
      peer.replaceBlock(
        { id: block.id, version: block.version },
        paragraph([text("hello, world")]),
      );
      peer.setSelection(null);

      // Undo — the History layer captured `preSel` at stack-item-added
      // time, so it should be restored on undo.
      peer.history.undo();
      // The captured selection is "what was current AT THE MOMENT of
      // the mutation" — which was preSel.
      const restored = peer.getSelection();
      expect(restored?.kind).toBe("caret");
      if (restored?.kind === "caret") {
        expect(restored.at.offset).toBe(5);
      }
    } finally {
      peer.destroy();
    }
  });
});
