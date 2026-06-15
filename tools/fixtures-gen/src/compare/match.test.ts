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
