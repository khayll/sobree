import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../../doc/builders";
import type { AnchoredFrame, InlineFrame, Paragraph, SobreeDocument } from "../../doc/types";
import { importDocx } from "../import";
import { exportDocx } from "./index";

/**
 * Round-trip suites for the Tier-1b completion slice: drawing GROUPS,
 * custom geometry, header/footer floating frames, float-run wrap sides
 * and `inline_frame` blocks — all through real `exportDocx` bytes
 * re-parsed by `importDocx`.
 */

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function baseDoc(): SobreeDocument {
  const doc = emptyDocument();
  doc.body = [paragraph([text("host one")]), paragraph([text("host two")])];
  doc.rawParts = { "word/media/image1.png": PNG, "word/media/image2.png": PNG };
  return doc;
}

async function roundTrip(doc: SobreeDocument): Promise<SobreeDocument> {
  return (await importDocx(exportDocx(doc).bytes)).document;
}

describe("group frame export round-trip", () => {
  it("round-trips a group: child coordinate system, children at local offsets", async () => {
    const doc = baseDoc();
    const child = (over: Partial<AnchoredFrame>): AnchoredFrame => ({
      id: "c",
      anchor: { sectionIndex: 0, horizontalFrom: "page", verticalFrom: "page" },
      offsetXEmu: 0,
      offsetYEmu: 0,
      widthEmu: 100,
      heightEmu: 100,
      content: { kind: "shape", geometry: "rect" },
      ...over,
    });
    doc.anchoredFrames = [
      {
        id: "g0",
        anchor: {
          sectionIndex: 0,
          paragraphIndex: 0,
          horizontalFrom: "margin",
          verticalFrom: "paragraph",
        },
        offsetXEmu: 914400,
        offsetYEmu: 0,
        widthEmu: 1828800,
        heightEmu: 914400,
        behindText: true,
        content: {
          kind: "group",
          childCoordSystemCx: 2000,
          childCoordSystemCy: 1000,
          childCoordOffsetX: 50,
          childCoordOffsetY: 25,
          children: [
            child({
              id: "c0",
              offsetXEmu: 50,
              offsetYEmu: 25,
              widthEmu: 800,
              heightEmu: 500,
              content: { kind: "picture", partPath: "word/media/image1.png" },
            }),
            child({
              id: "c1",
              offsetXEmu: 900,
              offsetYEmu: 100,
              widthEmu: 600,
              heightEmu: 400,
              content: { kind: "shape", geometry: "ellipse", fill: "#AA00AA" },
            }),
          ],
        },
      },
    ];

    const back = await roundTrip(doc);

    expect(back.anchoredFrames).toHaveLength(1);
    const g = back.anchoredFrames![0]!;
    expect(g.content.kind).toBe("group");
    const group = g.content as Extract<AnchoredFrame["content"], { kind: "group" }>;
    expect(group.childCoordSystemCx).toBe(2000);
    expect(group.childCoordSystemCy).toBe(1000);
    expect(group.childCoordOffsetX).toBe(50);
    expect(group.childCoordOffsetY).toBe(25);
    expect(group.children).toHaveLength(2);
    expect(group.children[0]).toMatchObject({
      offsetXEmu: 50,
      offsetYEmu: 25,
      widthEmu: 800,
      heightEmu: 500,
      content: { kind: "picture", partPath: "word/media/image1.png" },
    });
    expect(group.children[1]).toMatchObject({
      offsetXEmu: 900,
      widthEmu: 600,
      content: { kind: "shape", geometry: "ellipse", fill: "#AA00AA" },
    });
  });
});

describe("custom geometry export round-trip", () => {
  it("re-emits a:custGeom from the stored SVG path, byte-identical d", async () => {
    const doc = baseDoc();
    const d = "M 0 0 L 500 0 C 600 100 600 300 500 400 Q 250 500 0 400 Z";
    doc.anchoredFrames = [
      {
        id: "s0",
        anchor: {
          sectionIndex: 0,
          paragraphIndex: 0,
          horizontalFrom: "margin",
          verticalFrom: "paragraph",
        },
        offsetXEmu: 0,
        offsetYEmu: 0,
        widthEmu: 914400,
        heightEmu: 914400,
        behindText: true,
        content: {
          kind: "shape",
          geometry: "custom",
          fill: "#123456",
          path: { widthEmu: 600, heightEmu: 500, d },
        },
      },
    ];

    const back = await roundTrip(doc);

    const c = back.anchoredFrames![0]!.content;
    expect(c).toMatchObject({
      kind: "shape",
      geometry: "custom",
      fill: "#123456",
      path: { widthEmu: 600, heightEmu: 500, d },
    });
  });
});

describe("header/footer floating frames round-trip", () => {
  it("re-anchors a header's frame in its part, at its part paragraph", async () => {
    const doc = baseDoc();
    doc.sections = doc.sections.map((s) => ({
      ...s,
      headerRefs: [{ type: "default" as const, partId: "header1.xml" }],
    }));
    doc.headerFooterBodies = { "header1.xml": [paragraph([text("running head")])] };
    doc.headerFooterFrames = {
      "header1.xml": [
        {
          id: "h0",
          anchor: {
            sectionIndex: 0,
            paragraphIndex: 0,
            horizontalFrom: "page",
            verticalFrom: "page",
          },
          offsetXEmu: 111,
          offsetYEmu: 222,
          widthEmu: 914400,
          heightEmu: 457200,
          behindText: true,
          content: { kind: "picture", partPath: "word/media/image2.png" },
        },
      ],
    };

    const back = await roundTrip(doc);

    const frames = back.headerFooterFrames?.["header1.xml"];
    expect(frames).toHaveLength(1);
    expect(frames![0]).toMatchObject({
      offsetXEmu: 111,
      offsetYEmu: 222,
      behindText: true,
      content: { kind: "picture", partPath: "word/media/image2.png" },
    });
    // The header body text survives alongside.
    const headBody = back.headerFooterBodies["header1.xml"]!;
    expect((headBody[0] as Paragraph).runs.some((r) => r.kind === "text")).toBe(true);
  });
});

describe("float-run wrap side round-trip", () => {
  it("a floatRight drawing run comes back floatRight with its margins", async () => {
    const doc = baseDoc();
    doc.body = [
      paragraph([
        {
          kind: "drawing",
          partPath: "word/media/image1.png",
          widthEmu: 914400,
          heightEmu: 914400,
          placement: "floatRight",
          floatMarginsEmu: { topEmu: 0, rightEmu: 0, bottomEmu: 91440, leftEmu: 114300 },
        },
        text("wrapping text"),
      ]),
    ];

    const back = await roundTrip(doc);

    const host = back.body[0] as Paragraph;
    expect(host.runs[0]).toMatchObject({
      kind: "drawing",
      placement: "floatRight",
      floatMarginsEmu: { topEmu: 0, rightEmu: 0, bottomEmu: 91440, leftEmu: 114300 },
    });
    expect(host.runs.some((r) => r.kind === "text" && r.text === "wrapping text")).toBe(true);
  });
});

describe("inline_frame export round-trip", () => {
  it("a textbox-carrying group re-imports as the same inline_frame", async () => {
    const doc = baseDoc();
    const frame: InlineFrame = {
      kind: "inline_frame",
      groupExtentEmu: { wEmu: 4000, hEmu: 1000 },
      sizeEmu: { wEmu: 4000, hEmu: 1000 },
      textboxes: [
        {
          offsetEmu: { xEmu: 200, yEmu: 100 },
          sizeEmu: { wEmu: 3000, hEmu: 800 },
          body: [paragraph([text("pill heading")])],
          fill: "#EEDDCC",
          padding: { topEmu: 45720, rightEmu: 91440, bottomEmu: 45720, leftEmu: 91440 },
          vAlign: "center",
        },
      ],
      pictures: [
        {
          partPath: "word/media/image1.png",
          offsetEmu: { xEmu: 0, yEmu: 0 },
          sizeEmu: { wEmu: 4000, hEmu: 1000 },
        },
      ],
      shapes: [],
      keepNext: true,
    };
    doc.body = [frame, paragraph([text("after")])];

    const back = await roundTrip(doc);

    expect(back.body[0]!.kind).toBe("inline_frame");
    const f = back.body[0] as InlineFrame;
    expect(f.keepNext).toBe(true);
    expect(f.groupExtentEmu).toEqual({ wEmu: 4000, hEmu: 1000 });
    expect(f.textboxes[0]).toMatchObject({
      offsetEmu: { xEmu: 200, yEmu: 100 },
      sizeEmu: { wEmu: 3000, hEmu: 800 },
      fill: "#EEDDCC",
      vAlign: "center",
      padding: { topEmu: 45720, rightEmu: 91440, bottomEmu: 45720, leftEmu: 91440 },
    });
    expect((f.textboxes[0]!.body[0] as Paragraph).runs[0]).toMatchObject({
      kind: "text",
      text: "pill heading",
    });
    expect(f.pictures[0]).toMatchObject({ partPath: "word/media/image1.png" });
    expect((back.body[1] as Paragraph).runs[0]).toMatchObject({ text: "after" });
  });

  it("a picture-only BAND re-imports as the same inline_frame via the band pass", async () => {
    const doc = baseDoc();
    const frame: InlineFrame = {
      kind: "inline_frame",
      groupExtentEmu: { wEmu: 2000, hEmu: 500 },
      sizeEmu: { wEmu: 2000, hEmu: 500 },
      textboxes: [],
      shapes: [],
      pictures: [
        {
          partPath: "word/media/image1.png",
          offsetEmu: { xEmu: 0, yEmu: 0 },
          sizeEmu: { wEmu: 900, hEmu: 500 },
        },
        {
          partPath: "word/media/image2.png",
          offsetEmu: { xEmu: 1100, yEmu: 0 },
          sizeEmu: { wEmu: 900, hEmu: 500 },
        },
      ],
    };
    doc.body = [frame, paragraph([text("below the band")])];

    const back = await roundTrip(doc);

    expect(back.body[0]!.kind).toBe("inline_frame");
    const f = back.body[0] as InlineFrame;
    expect(f.groupExtentEmu).toEqual({ wEmu: 2000, hEmu: 500 });
    expect(f.pictures).toHaveLength(2);
    expect(f.pictures[0]).toMatchObject({
      partPath: "word/media/image1.png",
      offsetEmu: { xEmu: 0, yEmu: 0 },
    });
    expect(f.pictures[1]).toMatchObject({
      partPath: "word/media/image2.png",
      offsetEmu: { xEmu: 1100, yEmu: 0 },
    });
  });
});
