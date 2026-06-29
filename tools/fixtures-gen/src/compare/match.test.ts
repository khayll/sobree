import { describe, expect, it } from "vitest";
import type { LineMetric } from "../pdf/types";
import { matchBlocksToLines } from "./match";
import type { SnapshotBlock } from "./snapshot";

const block = (index: number, text: string): SnapshotBlock => ({
  index,
  tag: "P",
  text,
  fontSizePt: null,
  lineHeight: null,
  isChrome: false,
});

const line = (text: string): LineMetric => ({
  text,
  x: 0,
  y: 0,
  width: 100,
  height: 12,
  fontName: "Test",
  fontSize: 11,
});

describe("matchBlocksToLines: bounded prefix scan", () => {
  it("matches a block to its line within the scan window", () => {
    const blocks = [block(0, "Alpha"), block(1, "Bravo")];
    const lines = [line("Alpha"), line("Bravo")];
    const r = matchBlocksToLines(blocks, lines);
    expect(r.map((m) => m.matchType)).toEqual(["prefix", "prefix"]);
  });

  it("does NOT latch onto a coincidental match far beyond the window, and stays synced after a miss", () => {
    // A block whose text only appears >60 lines ahead must not jump the
    // cursor there (that was the desync: it stranded everything after).
    // The block goes unmatched, but the cursor stays put so the NEXT
    // block — whose line is right where we are — still matches.
    const filler = Array.from({ length: 80 }, (_, i) => line(`filler ${i}`));
    const blocks = [
      block(0, "OnlyFarAway"),
      block(1, "filler 0"), // sits at the very start, within window of cursor 0
    ];
    const lines = [...filler, line("OnlyFarAway")];

    const r = matchBlocksToLines(blocks, lines);
    expect(r[0]!.matchType).toBe("none"); // far match not latched
    expect(r[1]!.matchType).toBe("prefix"); // cursor never desynced
  });

  it("still finds a match that sits a few lines ahead (within the window)", () => {
    const blocks = [block(0, "Target")];
    const lines = [line("noise a"), line("noise b"), line("Target")];
    expect(matchBlocksToLines(blocks, lines)[0]!.matchType).toBe("prefix");
  });
});

describe("matchBlocksToLines: column-interleave recovery (phase 2)", () => {
  it("recovers a block stranded out of reading order (the two-column case)", () => {
    // Sobree emits logical order [L1, L2, R1, R2]; LibreOffice extracts the
    // two columns interleaved by Y and FUSES same-Y lines: [L1+R1, L2+R2].
    // The linear pass matches the left column; phase 2 recovers the right.
    const blocks = [
      block(0, "Left one"),
      block(1, "Left two"),
      block(2, "Right one"),
      block(3, "Right two"),
    ];
    const lines = [line("Left one Right one"), line("Left two Right two")];
    const r = matchBlocksToLines(blocks, lines);
    expect(r.map((m) => m.matchType)).toEqual(["prefix", "prefix", "substring", "substring"]);
    // The recovered blocks point at the fused line that carries their text.
    expect(r[2]!.pdfLines[0]!.text).toBe("Left one Right one");
    expect(r[3]!.pdfLines[0]!.text).toBe("Left two Right two");
  });

  it("matches loosely — list markers, curly-quote spacing, glued glyphs", () => {
    const blocks = [block(0, "header"), block(1, '"Basic Numbers" for lists')];
    // PDF order puts the target behind a fused line (so the linear cursor
    // skips it), with extraction's spacing artifacts around the quotes.
    const lines = [line("x “ Basic Numbers ”for lists"), line("header")];
    const r = matchBlocksToLines(blocks, lines);
    expect(r[0]!.matchType).toBe("prefix");
    expect(r[1]!.matchType).toBe("substring");
  });

  it("does not recover a coincidental match beyond the recovery window", () => {
    const filler = Array.from({ length: 80 }, (_, i) => line(`filler ${i}`));
    const blocks = [block(0, "filler 0"), block(1, "FarFarAway")];
    const lines = [...filler, line("FarFarAway")];
    const r = matchBlocksToLines(blocks, lines);
    expect(r[0]!.matchType).toBe("prefix"); // anchors at line 0
    expect(r[1]!.matchType).toBe("none"); // target 80 lines past the anchor
  });
});
