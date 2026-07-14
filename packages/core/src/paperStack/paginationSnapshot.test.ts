import { describe, expect, it } from "vitest";

import {
  type MeasureHeight,
  capturePaginationSnapshot,
  layoutStable,
  paginationUnchanged,
} from "./paginationSnapshot";

const doc = window.document;

/** jsdom has no layout, so heights come from a side table keyed by element. */
function measured(heights: Map<HTMLElement, number>): MeasureHeight {
  return (el) => heights.get(el) ?? 0;
}

function block(tag: string, text = "", attrs: Record<string, string> = {}): HTMLElement {
  const el = doc.createElement(tag);
  if (text) el.textContent = text;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

describe("paginationUnchanged", () => {
  it("skips when references, heights, and budget all match", () => {
    const a = block("p", "alpha");
    const b = block("p", "beta");
    const h = new Map([
      [a, 20],
      [b, 20],
    ]);
    const snap = capturePaginationSnapshot([a, b], 500, measured(h));
    expect(paginationUnchanged(snap, [a, b], 500, measured(h))).toBe(true);
  });

  it("allows text to change at constant height for an unsplit block (the typing case)", () => {
    const a = block("p", "alpha");
    const h = new Map([[a, 20]]);
    const snap = capturePaginationSnapshot([a], 500, measured(h));
    // Same element, same height, different text — a char typed mid-line that
    // didn't wrap. Break can't move ⇒ skip.
    a.textContent = "alphax";
    expect(paginationUnchanged(snap, [a], 500, measured(h))).toBe(true);
  });

  it("re-flows when a block's height changed (a line wrapped)", () => {
    const a = block("p", "alpha");
    const before = new Map([[a, 20]]);
    const snap = capturePaginationSnapshot([a], 500, measured(before));
    const after = new Map([[a, 40]]);
    expect(paginationUnchanged(snap, [a], 500, measured(after))).toBe(false);
  });

  it("re-flows when the page budget changed", () => {
    const a = block("p", "alpha");
    const h = new Map([[a, 20]]);
    const snap = capturePaginationSnapshot([a], 500, measured(h));
    expect(paginationUnchanged(snap, [a], 480, measured(h))).toBe(false);
  });

  it("re-flows when a block was inserted (count differs)", () => {
    const a = block("p", "alpha");
    const b = block("p", "beta");
    const h = new Map([
      [a, 20],
      [b, 20],
    ]);
    const snap = capturePaginationSnapshot([a], 500, measured(h));
    expect(paginationUnchanged(snap, [a, b], 500, measured(h))).toBe(false);
  });

  it("re-flows when a block's node was replaced even if height matches (a re-render)", () => {
    const a = block("p", "alpha");
    const snap = capturePaginationSnapshot([a], 500, () => 20);
    // Fresh node, same text/height — what an API commit produces. Must re-flow
    // so the paginated structure is rebuilt, not left stale.
    const fresh = block("p", "alpha");
    expect(paginationUnchanged(snap, [fresh], 500, () => 20)).toBe(false);
  });

  describe("split fragments (constant-height text redistribution hazard)", () => {
    it("re-flows when a split fragment's text changed at constant height", () => {
      // Two <p> fragments of one logical paragraph, split across a page break,
      // share a data-pag-pid.
      const f1 = block("p", "hello wor", { "data-pag-pid": "p1" });
      const f2 = block("p", "ld", { "data-pag-pid": "p1" });
      const h = new Map([
        [f1, 20],
        [f2, 20],
      ]);
      const snap = capturePaginationSnapshot([f1, f2], 500, measured(h));
      // Edit the first fragment — same height, but text belonging across the
      // boundary shifts; a full re-flow would re-split differently.
      f1.textContent = "hello worX";
      expect(paginationUnchanged(snap, [f1, f2], 500, measured(h))).toBe(false);
    });

    it("does NOT treat a lone pid'd block (count 1) as a split fragment", () => {
      // A paragraph that carries a pid but isn't actually split anywhere is a
      // whole block — height guard alone is sufficient, text may change.
      const only = block("p", "hello", { "data-pag-pid": "p9" });
      const h = new Map([[only, 20]]);
      const snap = capturePaginationSnapshot([only], 500, measured(h));
      only.textContent = "hellox";
      expect(paginationUnchanged(snap, [only], 500, measured(h))).toBe(true);
    });

    it("guards column containers with the text check too", () => {
      const cols = block("div", "left right");
      cols.className = "sobree-cols";
      const h = new Map([[cols, 100]]);
      const snap = capturePaginationSnapshot([cols], 500, measured(h));
      cols.textContent = "left rightX";
      expect(paginationUnchanged(snap, [cols], 500, measured(h))).toBe(false);
    });
  });
});

describe("layoutStable (fixpoint arming test)", () => {
  it("is true for two re-flows with identical heights but DIFFERENT nodes", () => {
    // A re-flow re-splits into fresh fragment nodes; the fixpoint test must
    // look through node identity and compare geometry only.
    const before = capturePaginationSnapshot([block("p"), block("p")], 500, () => 20);
    const after = capturePaginationSnapshot([block("p"), block("p")], 500, () => 20);
    expect(layoutStable(before, after)).toBe(true);
  });

  it("is false when the re-flow moved a break (a height changed)", () => {
    const before = capturePaginationSnapshot([block("p"), block("p")], 500, () => 20);
    const a2 = block("p");
    const b2 = block("p");
    const after = capturePaginationSnapshot([a2, b2], 500, (el) => (el === b2 ? 40 : 20));
    expect(layoutStable(before, after)).toBe(false);
  });

  it("is false when the re-flow changed the block count (split added a fragment)", () => {
    const before = capturePaginationSnapshot([block("p")], 500, () => 20);
    const after = capturePaginationSnapshot([block("p"), block("p")], 500, () => 20);
    expect(layoutStable(before, after)).toBe(false);
  });

  it("is false when a split fragment's text moved at constant height", () => {
    const b1 = block("p", "hello wor", { "data-pag-pid": "p1" });
    const b2 = block("p", "ld", { "data-pag-pid": "p1" });
    const before = capturePaginationSnapshot([b1, b2], 500, () => 20);
    // Same heights, same split, but the boundary text shifted — a re-split
    // landed differently, so this is NOT a fixpoint.
    const a1 = block("p", "hello worl", { "data-pag-pid": "p1" });
    const a2 = block("p", "d", { "data-pag-pid": "p1" });
    const after = capturePaginationSnapshot([a1, a2], 500, () => 20);
    expect(layoutStable(before, after)).toBe(false);
  });
});
