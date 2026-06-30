import { describe, expect, it } from "vitest";
import type { AnchoredFrame, Block, InlineFrame, Paragraph } from "../../doc/types";
import { groupAnchoredPictureBands } from "./imageBands";

function empty(): Paragraph {
  return { kind: "paragraph", runs: [], properties: {} };
}
function para(text: string): Paragraph {
  return { kind: "paragraph", runs: [{ kind: "text", text, properties: {} }], properties: {} };
}

/** A band picture: paragraph-anchored, displacing wrap, margin origin. */
const pic = (id: string, x: number, over: Partial<AnchoredFrame> = {}): AnchoredFrame => ({
  id,
  anchor: { sectionIndex: 0, paragraphIndex: 1, horizontalFrom: "margin", verticalFrom: "margin" },
  offsetXEmu: x,
  offsetYEmu: 0,
  widthEmu: 1_000_000,
  heightEmu: 1_200_000,
  wrap: "square",
  content: { kind: "picture", partPath: `word/media/${id}.png` },
  ...over,
});

const band = (out: { body: Block[] }): InlineFrame => out.body[1] as InlineFrame;

describe("groupAnchoredPictureBands", () => {
  it("coalesces a row of same-paragraph pictures into one in-flow InlineFrame", () => {
    // Three images stepped across the page at the same Y, anchored to an empty
    // paragraph — the farm-loss banner strip.
    const frames = [pic("a", 0), pic("b", 1_100_000), pic("c", 2_200_000)];
    const out = groupAnchoredPictureBands([para("title"), empty(), para("below")], frames);

    // All three left the overlay set.
    expect(out.frames).toEqual([]);
    const f = band(out);
    expect(f.kind).toBe("inline_frame");
    // Extent spans the band: 0 → 2,200,000 + 1,000,000 width.
    expect(f.groupExtentEmu).toEqual({ wEmu: 3_200_000, hEmu: 1_200_000 });
    // Pictures ordered left-to-right, offset relative to the band origin.
    expect(f.pictures.map((p) => p.offsetEmu.xEmu)).toEqual([0, 1_100_000, 2_200_000]);
    expect(f.pictures.map((p) => p.partPath)).toEqual([
      "word/media/a.png",
      "word/media/b.png",
      "word/media/c.png",
    ]);
    // The body length is preserved (empty anchor paragraph replaced in place).
    expect(out.body).toHaveLength(3);
    expect(out.body[2]).toMatchObject({ kind: "paragraph" });
  });

  it("leaves a lone image for the float pass", () => {
    const out = groupAnchoredPictureBands([para("t"), empty()], [pic("a", 0)]);
    expect(out.frames).toHaveLength(1);
    expect(out.body[1]).toMatchObject({ kind: "paragraph" });
  });

  it("does not band a vertical stack (no shared horizontal band)", () => {
    const stacked = [pic("a", 0), pic("b", 0, { offsetYEmu: 2_000_000 })];
    const out = groupAnchoredPictureBands([para("t"), empty()], stacked);
    expect(out.frames).toHaveLength(2);
  });

  it("does not claim a non-empty anchor paragraph (would lose its text)", () => {
    const frames = [pic("a", 0), pic("b", 1_100_000)];
    const out = groupAnchoredPictureBands([para("t"), para("has text")], frames);
    expect(out.frames).toHaveLength(2);
    expect(out.body[1]).toMatchObject({ kind: "paragraph" });
  });

  it("does not band frames with mismatched coordinate origins", () => {
    const mixed = [
      pic("a", 0),
      pic("b", 1_100_000, {
        anchor: {
          sectionIndex: 0,
          paragraphIndex: 1,
          horizontalFrom: "page",
          verticalFrom: "margin",
        },
      }),
    ];
    const out = groupAnchoredPictureBands([para("t"), empty()], mixed);
    expect(out.frames).toHaveLength(2);
  });

  it("ignores non-displacing and behind-text frames", () => {
    const frames = [pic("a", 0, { wrap: "none" }), pic("b", 1_100_000, { behindText: true })];
    const out = groupAnchoredPictureBands([para("t"), empty()], frames);
    expect(out.frames).toHaveLength(2);
  });
});
