import { describe, expect, it } from "vitest";
import {
  type BlockRef,
  type EditResult,
  caretAt,
  fail,
  inlineAt,
  isCaret,
  isCollapsedRange,
  lockConflict,
  makeRange,
  ok,
  sameBlock,
} from "./api";

const b1: BlockRef = { id: "b1", version: 0 };
const b2: BlockRef = { id: "b2", version: 5 };

describe("InlinePosition helpers", () => {
  it("inlineAt builds a position with a block + offset", () => {
    expect(inlineAt(b1, 7)).toEqual({ block: b1, offset: 7 });
  });

  it("sameBlock compares by id, ignoring version", () => {
    const stale: BlockRef = { id: "b1", version: 0 };
    const fresh: BlockRef = { id: "b1", version: 99 };
    expect(sameBlock(inlineAt(stale, 0), inlineAt(fresh, 5))).toBe(true);
    expect(sameBlock(inlineAt(b1, 0), inlineAt(b2, 0))).toBe(false);
  });
});

describe("Range / Selection helpers", () => {
  it("makeRange wires from/to verbatim", () => {
    const from = inlineAt(b1, 0);
    const to = inlineAt(b2, 4);
    expect(makeRange(from, to)).toEqual({ from, to });
  });

  it("caretAt builds a caret selection", () => {
    const sel = caretAt(inlineAt(b1, 3));
    expect(sel).toEqual({ kind: "caret", at: inlineAt(b1, 3) });
  });

  it("isCollapsedRange flags zero-width ranges", () => {
    const r = makeRange(inlineAt(b1, 4), inlineAt(b1, 4));
    expect(isCollapsedRange(r)).toBe(true);
    const r2 = makeRange(inlineAt(b1, 4), inlineAt(b1, 5));
    expect(isCollapsedRange(r2)).toBe(false);
    const r3 = makeRange(inlineAt(b1, 0), inlineAt(b2, 0));
    expect(isCollapsedRange(r3)).toBe(false);
  });

  it("isCaret recognises both caret selections and collapsed ranges", () => {
    expect(isCaret(caretAt(inlineAt(b1, 0)))).toBe(true);
    expect(isCaret({ kind: "range", range: makeRange(inlineAt(b1, 3), inlineAt(b1, 3)) })).toBe(
      true,
    );
    expect(isCaret({ kind: "range", range: makeRange(inlineAt(b1, 0), inlineAt(b1, 5)) })).toBe(
      false,
    );
    expect(isCaret(null)).toBe(false);
  });
});

describe("EditResult helpers", () => {
  it("ok wraps a successful value with affected blocks", () => {
    const r = ok(42, [b1, b2]);
    expect(r).toEqual({ ok: true, value: 42, affected: [b1, b2] });
  });

  it("ok defaults affected to empty array", () => {
    const r: EditResult<string> = ok("hi");
    if (r.ok) expect(r.affected).toEqual([]);
    else throw new Error("expected ok");
  });

  it("fail wraps a structured error", () => {
    const r = fail({ code: "unknown-block", blockId: "b99" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unknown-block");
  });

  it("lockConflict shapes the optimistic-lock failure", () => {
    const r = lockConflict([
      { blockId: "b1", expected: 0, actual: 1 },
      { blockId: "b3", expected: 4, actual: null },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("optimistic-lock");
      if (r.error.code === "optimistic-lock") {
        expect(r.error.conflicts).toHaveLength(2);
        expect(r.error.conflicts[1]?.actual).toBeNull();
      }
    }
  });
});

describe("JSON-cleanliness", () => {
  it("InlinePosition survives JSON round-trip", () => {
    const p = inlineAt(b1, 7);
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });

  it("Range survives JSON round-trip", () => {
    const r = makeRange(inlineAt(b1, 0), inlineAt(b2, 12));
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("Selection (range) survives JSON round-trip", () => {
    const sel = { kind: "range" as const, range: makeRange(inlineAt(b1, 0), inlineAt(b1, 4)) };
    expect(JSON.parse(JSON.stringify(sel))).toEqual(sel);
  });

  it("EditResult survives JSON round-trip", () => {
    const r = ok({ kind: "paragraph" }, [b1, b2]);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("OptimisticLock failure survives JSON round-trip", () => {
    const r = lockConflict([{ blockId: "b1", expected: 1, actual: 2 }]);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});
