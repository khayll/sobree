import { describe, expect, it } from "vitest";
import { buildDrift } from "./drift";
import type { MatchResult } from "./match";
import type { SnapshotBlock } from "./snapshot";

function snap(over: Partial<SnapshotBlock> = {}): SnapshotBlock {
  return {
    index: 0,
    tag: "P",
    text: "Lorem ipsum dolor sit amet",
    fontSizePt: 10,
    lineHeight: 1.3,
    isChrome: false,
    ...over,
  };
}

function ln(x: number, y: number): MatchResult["pdfLines"][number] {
  return { text: "x", x, y, width: 100, height: 12, fontName: "T", fontSize: 10 };
}

function match(block: SnapshotBlock, pdfLines: MatchResult["pdfLines"]): MatchResult {
  return { block, pdfLines, matchType: "prefix" };
}

describe("buildDrift: column-consistent leading", () => {
  it("ignores a callout squeezed between two body lines (multi-column)", () => {
    // Two body lines 13pt apart (10pt text → effective LH 1.3, matching the
    // declared 1.3 → ~zero drift). A stat callout in the OTHER column sits
    // at a different x, between them by Y; counting it would halve Δy.
    const block = snap();
    const lines = [ln(56, 407), ln(263, 400), ln(56, 394)];
    const d = buildDrift("f", [match(block, lines)]);
    expect(d.blocks[0]!.pdfDeltaY).toBe(13);
    expect(d.blocks[0]!.lineHeightDrift!).toBeCloseTo(0, 5);
  });

  it("rejects a continuation line that jumps a column / page (> 3× font size)", () => {
    const block = snap();
    // 150 → 137 is a real 13pt step; 137 → 760 is a page jump and must not
    // be measured as leading.
    const lines = [ln(50, 150), ln(50, 137), ln(50, 760)];
    const d = buildDrift("f", [match(block, lines)]);
    expect(d.blocks[0]!.pdfDeltaY).toBe(13);
  });

  it("yields no drift when fewer than two lines share the column", () => {
    const block = snap();
    // Every line is in a different column from the first ⇒ unreliable group.
    const lines = [ln(50, 150), ln(320, 145), ln(580, 140)];
    const d = buildDrift("f", [match(block, lines)]);
    expect(d.blocks[0]!.pdfDeltaY).toBeNull();
    expect(d.multiLineBlocks).toBe(0);
    expect(d.meanAbsDrift).toBeNull();
  });

  it("leaves a clean single-column paragraph unchanged", () => {
    const block = snap({ lineHeight: 1.2 });
    const lines = [ln(50, 200), ln(50, 188), ln(50, 176)]; // 12pt steps
    const d = buildDrift("f", [match(block, lines)]);
    expect(d.blocks[0]!.pdfDeltaY).toBe(12);
    expect(d.blocks[0]!.lineHeightDrift!).toBeCloseTo(0, 5);
  });
});
