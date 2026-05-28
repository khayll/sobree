import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { type DeltaOp, runsToDelta, deltaToRuns } from "./runs";
import { diffApplyText } from "./textDiff";

function makeYText(initialDelta: readonly DeltaOp[]): Y.Text {
  const ydoc = new Y.Doc();
  const t = ydoc.getText("t");
  t.applyDelta(initialDelta as Array<{ insert: unknown; attributes?: object }>);
  return t;
}

function deltaOf(t: Y.Text): DeltaOp[] {
  return t.toDelta() as DeltaOp[];
}

describe("diffApplyText — basic shapes", () => {
  it("no-op when current matches target", () => {
    const t = makeYText([{ insert: "Hello" }]);
    let updates = 0;
    t.observe(() => updates++);
    diffApplyText(t, [{ insert: "Hello" }]);
    expect(updates).toBe(0);
    expect(t.toString()).toBe("Hello");
  });

  it("insert at end", () => {
    const t = makeYText([{ insert: "Hello" }]);
    diffApplyText(t, [{ insert: "Hello world" }]);
    expect(t.toString()).toBe("Hello world");
  });

  it("insert at beginning", () => {
    const t = makeYText([{ insert: "world" }]);
    diffApplyText(t, [{ insert: "Hello world" }]);
    expect(t.toString()).toBe("Hello world");
  });

  it("insert in middle", () => {
    const t = makeYText([{ insert: "Helo" }]);
    diffApplyText(t, [{ insert: "Hello" }]);
    expect(t.toString()).toBe("Hello");
  });

  it("delete from end", () => {
    const t = makeYText([{ insert: "Hello world" }]);
    diffApplyText(t, [{ insert: "Hello" }]);
    expect(t.toString()).toBe("Hello");
  });

  it("delete from beginning", () => {
    const t = makeYText([{ insert: "Hello world" }]);
    diffApplyText(t, [{ insert: "world" }]);
    expect(t.toString()).toBe("world");
  });

  it("delete from middle", () => {
    const t = makeYText([{ insert: "Hello cruel world" }]);
    diffApplyText(t, [{ insert: "Hello world" }]);
    expect(t.toString()).toBe("Hello world");
  });

  it("replace whole content (degenerate diff)", () => {
    const t = makeYText([{ insert: "abc" }]);
    diffApplyText(t, [{ insert: "xyz" }]);
    expect(t.toString()).toBe("xyz");
  });

  it("insert and delete in same diff (typing one char while another is deleted)", () => {
    const t = makeYText([{ insert: "abXc" }]);
    diffApplyText(t, [{ insert: "abYc" }]);
    expect(t.toString()).toBe("abYc");
  });
});

describe("diffApplyText — minimal mutation guarantees", () => {
  // The whole point of the diff. Adjacent characters that didn't
  // change must NOT be touched — Yjs CRDT identity must survive.
  it("inserting one char in middle: only that char's position is mutated", () => {
    const t = makeYText([{ insert: "Hello world" }]);
    const events: Array<unknown> = [];
    t.observe((evt) => events.push(evt.changes.delta));
    diffApplyText(t, [{ insert: "Hello, world" }]);
    expect(t.toString()).toBe("Hello, world");
    // The delta should be 1 retain + 1 insert (no deletes).
    expect(events.length).toBe(1);
    const delta = events[0] as Array<{ retain?: number; insert?: string; delete?: number }>;
    const inserts = delta.filter((d) => "insert" in d);
    const deletes = delta.filter((d) => "delete" in d);
    expect(inserts.length).toBe(1);
    expect(deletes.length).toBe(0);
  });

  it("deleting one char in middle: only that char is removed", () => {
    const t = makeYText([{ insert: "Hello, world" }]);
    const events: Array<unknown> = [];
    t.observe((evt) => events.push(evt.changes.delta));
    diffApplyText(t, [{ insert: "Hello world" }]);
    expect(t.toString()).toBe("Hello world");
    const delta = events[0] as Array<{ delete?: number; insert?: string }>;
    const deletes = delta.filter((d) => "delete" in d);
    expect(deletes.length).toBe(1);
  });
});

describe("diffApplyText — format-only fast path", () => {
  it("bolding the whole text uses format() not delete+reinsert", () => {
    const t = makeYText([{ insert: "Hello" }]);
    const events: Array<unknown> = [];
    t.observe((evt) => events.push(evt.changes.delta));
    diffApplyText(t, [{ insert: "Hello", attributes: { bold: true } }]);
    expect(t.toString()).toBe("Hello");
    expect(deltaOf(t)).toEqual([{ insert: "Hello", attributes: { bold: true } }]);
    // Delta should contain no inserts/deletes; only retains-with-attrs.
    const delta = events[0] as Array<{
      retain?: number;
      insert?: string;
      delete?: number;
      attributes?: object;
    }>;
    expect(delta.every((op) => !("insert" in op) && !("delete" in op))).toBe(true);
  });

  it("bolding part of text only formats that part", () => {
    const t = makeYText([{ insert: "Hello world" }]);
    diffApplyText(t, [
      { insert: "Hello " },
      { insert: "world", attributes: { bold: true } },
    ]);
    expect(deltaOf(t)).toEqual([
      { insert: "Hello " },
      { insert: "world", attributes: { bold: true } },
    ]);
  });

  it("removing a mark (bold → none) emits format with null", () => {
    const t = makeYText([{ insert: "Hello", attributes: { bold: true } }]);
    diffApplyText(t, [{ insert: "Hello" }]);
    expect(deltaOf(t)).toEqual([{ insert: "Hello" }]);
  });

  it("changing a mark value (color red → blue)", () => {
    const t = makeYText([{ insert: "Hi", attributes: { color: "#f00" } }]);
    diffApplyText(t, [{ insert: "Hi", attributes: { color: "#00f" } }]);
    expect(deltaOf(t)).toEqual([{ insert: "Hi", attributes: { color: "#00f" } }]);
  });
});

describe("diffApplyText — embeds", () => {
  it("inserting an embed in the middle", () => {
    const t = makeYText([{ insert: "abc" }]);
    diffApplyText(t, [
      { insert: "ab" },
      { insert: { __sobree: "tab" } },
      { insert: "c" },
    ]);
    const out = deltaOf(t);
    expect(out).toEqual([
      { insert: "ab" },
      { insert: { __sobree: "tab" } },
      { insert: "c" },
    ]);
  });

  it("embed round-trip via runs", () => {
    const t = makeYText([{ insert: "ab" }]);
    const runs = deltaToRuns([
      { insert: "ab" },
      { insert: { __sobree: "break", type: "line" } },
      { insert: "c" },
    ]);
    diffApplyText(t, runsToDelta(runs));
    expect(deltaToRuns(deltaOf(t))).toEqual(runs);
  });
});

describe("diffApplyText — concurrent edits via two Y.Docs", () => {
  // The key test: two peers each typing into the same Y.Text. After
  // sync, both inserts are present.
  it("inserts at different positions merge", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const tA = docA.getText("p");
    const tB = docB.getText("p");
    // Seed both with the same starting text by syncing.
    tA.insert(0, "Hello world");
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    expect(tB.toString()).toBe("Hello world");

    // Peer A inserts ", "  after position 5; peer B inserts "!" at
    // the end. Use diffApplyText to simulate the Editor's apply path.
    diffApplyText(tA, [{ insert: "Hello, world" }]);
    diffApplyText(tB, [{ insert: "Hello world!" }]);

    // Sync both ways.
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // Both inserts survived.
    expect(tA.toString()).toBe(tB.toString());
    expect(tA.toString()).toBe("Hello, world!");
  });

  it("formatting one range while typing into another preserves both edits", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const tA = docA.getText("p");
    const tB = docB.getText("p");
    tA.insert(0, "Hello world");
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // A bolds "world" (chars 6..10). B inserts "!" at the end.
    diffApplyText(tA, [
      { insert: "Hello " },
      { insert: "world", attributes: { bold: true } },
    ]);
    diffApplyText(tB, [{ insert: "Hello world!" }]);

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const finalA = deltaOf(tA);
    const finalB = deltaOf(tB);
    // Load-bearing assertions for this test:
    //   1. Convergence — both peers see the same delta after sync.
    //   2. Both edits survived — text reads "Hello world!" and at
    //      least one bold span exists.
    expect(finalA).toEqual(finalB);
    expect(tA.toString()).toBe("Hello world!");
    expect(tB.toString()).toBe("Hello world!");
    // Whether "world!" merges with bold extension or stays as
    // "world" (bold) + "!" (plain) depends on Yjs's mark-expansion
    // tie-breaking (clientID-dependent and not part of our
    // contract). Both shapes are valid CRDT outcomes.
    const hasBoldSpan = finalA.some(
      (op) =>
        typeof op.insert === "string" &&
        op.insert.includes("world") &&
        op.attributes?.bold === true,
    );
    expect(hasBoldSpan).toBe(true);
  });
});
