import { describe, expect, it } from "vitest";
import { floatWrappingImages } from "./floatFrames";
import type { AnchoredFrame, Block, DrawingRun, Paragraph, SectionProperties } from "../../doc/types";

function para(text: string): Paragraph {
  return { kind: "paragraph", runs: [{ kind: "text", text, properties: {} }], properties: {} };
}

const picFrame = (over: Partial<AnchoredFrame> = {}): AnchoredFrame => ({
  id: "f1",
  anchor: { sectionIndex: 0, paragraphIndex: 0, horizontalFrom: "margin", verticalFrom: "paragraph" },
  offsetXEmu: 0,
  offsetYEmu: 0,
  widthEmu: 914400,
  heightEmu: 914400,
  wrap: "square",
  content: { kind: "picture", partPath: "word/media/image1.png" },
  ...over,
});

const sections: SectionProperties[] = [
  {
    pageSize: { wTwips: 12240, hTwips: 15840, orientation: "portrait" },
    pageMargins: {
      topTwips: 1440,
      rightTwips: 1440,
      bottomTwips: 1440,
      leftTwips: 1440,
      headerTwips: 720,
      footerTwips: 720,
      gutterTwips: 0,
    },
    headerRefs: [],
    footerRefs: [],
  },
];

const firstRun = (body: Block[]): DrawingRun => (body[0] as Paragraph).runs[0] as DrawingRun;

describe("floatWrappingImages", () => {
  it("prepends a float run to the anchor paragraph and drops the frame from the overlay set", () => {
    const out = floatWrappingImages([para("anchor"), para("after")], [picFrame()], sections);
    expect(out.frames).toEqual([]);
    expect(firstRun(out.body)).toMatchObject({
      kind: "drawing",
      partPath: "word/media/image1.png",
      widthEmu: 914400,
      heightEmu: 914400,
    });
    expect(firstRun(out.body).placement).toMatch(/^float/);
    // following paragraph untouched
    expect((out.body[1] as Paragraph).runs[0]).toMatchObject({ kind: "text", text: "after" });
  });

  it("maps wrapText: right→floatLeft, left→floatRight", () => {
    expect(firstRun(floatWrappingImages([para("a")], [picFrame({ wrapText: "right" })], sections).body).placement).toBe("floatLeft");
    expect(firstRun(floatWrappingImages([para("a")], [picFrame({ wrapText: "left" })], sections).body).placement).toBe("floatRight");
  });

  it("bothSides floats to whichever margin the image sits nearer", () => {
    const right = floatWrappingImages([para("a")], [picFrame({ wrapText: "bothSides", offsetXEmu: 5_000_000 })], sections);
    expect(firstRun(right.body).placement).toBe("floatRight");
    const left = floatWrappingImages([para("a")], [picFrame({ wrapText: "bothSides", offsetXEmu: 0 })], sections);
    expect(firstRun(left.body).placement).toBe("floatLeft");
  });

  it("carries distT/B/L/R clearance as float margins", () => {
    const dist = { topEmu: 1, rightEmu: 2, bottomEmu: 3, leftEmu: 4 };
    expect(firstRun(floatWrappingImages([para("a")], [picFrame({ textDistancesEmu: dist })], sections).body).floatMarginsEmu).toEqual(dist);
  });

  it("leaves non-floatable frames as overlays (behind-text / wrapNone / textbox)", () => {
    const behind = picFrame({ id: "b", behindText: true });
    const none = picFrame({ id: "n", wrap: "none" });
    const tbox = picFrame({ id: "t", content: { kind: "textbox", body: [para("x")] } });
    const out = floatWrappingImages([para("a")], [behind, none, tbox], sections);
    expect(out.frames.map((f) => f.id).sort()).toEqual(["b", "n", "t"]);
    expect((out.body[0] as Paragraph).runs.length).toBe(1);
  });
});
