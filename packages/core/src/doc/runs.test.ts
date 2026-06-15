import { describe, expect, it } from "vitest";
import {
  applyRunPropertiesToRuns,
  mergeAdjacentTextRuns,
  runLength,
  runsLength,
  sliceRuns,
  splitRunsAt,
} from "./runs";
import type { HyperlinkRun, InlineRun, TextRun } from "./types";

const t = (text: string, props: TextRun["properties"] = {}): TextRun => ({
  kind: "text",
  text,
  properties: props,
});

describe("runLength / runsLength", () => {
  it("counts text, atoms, and hyperlinks correctly", () => {
    expect(runLength(t("hello"))).toBe(5);
    expect(runLength({ kind: "break", type: "line" })).toBe(1);
    expect(runLength({ kind: "tab" })).toBe(1);
    expect(
      runLength({
        kind: "drawing",
        partPath: "x",
        widthEmu: 0,
        heightEmu: 0,
        placement: "inline",
      }),
    ).toBe(1);
    expect(runLength({ kind: "field", instruction: "PAGE", cached: "42" })).toBe(2);
    const link: HyperlinkRun = {
      kind: "hyperlink",
      href: "x",
      children: [t("foo"), { kind: "break", type: "line" }],
    };
    expect(runLength(link)).toBe(4);
    expect(runsLength([t("ab"), t("cd")])).toBe(4);
  });
});

describe("splitRunsAt", () => {
  it("splits through a text run", () => {
    const { before, after } = splitRunsAt([t("hello world")], 5);
    expect(before).toEqual([t("hello")]);
    expect(after).toEqual([t(" world")]);
  });

  it("respects run boundaries — whole-run before/after", () => {
    const { before, after } = splitRunsAt([t("abc"), t("def")], 3);
    expect(before).toEqual([t("abc")]);
    expect(after).toEqual([t("def")]);
  });

  it("splits across two runs", () => {
    const { before, after } = splitRunsAt([t("abc"), t("def")], 4);
    expect(before).toEqual([t("abc"), t("d")]);
    expect(after).toEqual([t("ef")]);
  });

  it("offset 0 puts everything in after", () => {
    const { before, after } = splitRunsAt([t("abc")], 0);
    expect(before).toEqual([]);
    expect(after).toEqual([t("abc")]);
  });

  it("offset past the end puts everything in before", () => {
    const { before, after } = splitRunsAt([t("abc")], 99);
    expect(before).toEqual([t("abc")]);
    expect(after).toEqual([]);
  });

  it("splits cleanly at an atom boundary", () => {
    const br: InlineRun = { kind: "break", type: "line" };
    const { before, after } = splitRunsAt([t("ab"), br, t("cd")], 3);
    // Offset 3 lands just AFTER the <br> (pos 2..3 spans the atom).
    expect(before).toEqual([t("ab"), br]);
    expect(after).toEqual([t("cd")]);
  });

  it("atoms stay whole on the after side when split falls mid-atom", () => {
    // "ab" (len 2) + br (len 1); offset=2 → split at atom's start
    // boundary — atom goes to after.
    const br: InlineRun = { kind: "break", type: "line" };
    const { before, after } = splitRunsAt([t("ab"), br], 2);
    expect(before).toEqual([t("ab")]);
    expect(after).toEqual([br]);
  });

  it("splits inside a hyperlink, preserving href on both halves", () => {
    const link: HyperlinkRun = { kind: "hyperlink", href: "https://x", children: [t("abcdef")] };
    const { before, after } = splitRunsAt([link], 3);
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(before[0]).toMatchObject({ kind: "hyperlink", href: "https://x" });
    expect(after[0]).toMatchObject({ kind: "hyperlink", href: "https://x" });
  });
});

describe("sliceRuns", () => {
  it("extracts a contiguous slice", () => {
    const runs = [t("Hello world")];
    expect(sliceRuns(runs, 6, 11)).toEqual([t("world")]);
  });

  it("returns empty on zero-width slice", () => {
    expect(sliceRuns([t("abc")], 2, 2)).toEqual([]);
  });
});

describe("applyRunPropertiesToRuns", () => {
  it("merges patch into every TextRun's properties", () => {
    const out = applyRunPropertiesToRuns([t("hi"), t(" world", { bold: true })], {
      italic: true,
    });
    expect(out[0]).toMatchObject({ text: "hi", properties: { italic: true } });
    expect(out[1]).toMatchObject({
      text: " world",
      properties: { bold: true, italic: true },
    });
  });

  it("recurses into hyperlinks", () => {
    const link: HyperlinkRun = { kind: "hyperlink", href: "x", children: [t("click")] };
    const out = applyRunPropertiesToRuns([link], { color: "#f00" });
    const outLink = out[0] as HyperlinkRun;
    expect((outLink.children[0] as TextRun).properties.color).toBe("#f00");
  });

  it("undefined in patch clears the property", () => {
    const out = applyRunPropertiesToRuns([t("hi", { bold: true, italic: true })], {
      bold: undefined,
    });
    expect((out[0] as TextRun).properties).toEqual({ italic: true });
  });
});

describe("mergeAdjacentTextRuns", () => {
  it("merges adjacent TextRuns with identical properties", () => {
    const out = mergeAdjacentTextRuns([t("ab"), t("cd"), t("ef")]);
    expect(out).toEqual([t("abcdef")]);
  });

  it("keeps adjacent TextRuns with differing properties apart", () => {
    const out = mergeAdjacentTextRuns([t("ab"), t("cd", { bold: true }), t("ef")]);
    expect(out).toHaveLength(3);
  });

  it("leaves atoms in place", () => {
    const br: InlineRun = { kind: "break", type: "line" };
    const out = mergeAdjacentTextRuns([t("ab"), br, t("cd")]);
    expect(out).toEqual([t("ab"), br, t("cd")]);
  });
});
