import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../../doc/builders";
import type { AnchoredFrame, Paragraph, SobreeDocument } from "../../doc/types";
import { importDocx } from "../import";
import { exportDocx } from "./index";

/**
 * Round-trip suite for `<wp:anchor>` emission — real `exportDocx` bytes
 * re-parsed by `importDocx`, proving the emitted DrawingML is what the
 * anchored-frame importer reads back.
 */

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function baseDoc(): SobreeDocument {
  const doc = emptyDocument();
  doc.body = [paragraph([text("host one")]), paragraph([text("host two")])];
  doc.rawParts = { "word/media/image1.png": PNG };
  return doc;
}

function frame(overrides: Partial<AnchoredFrame>): AnchoredFrame {
  return {
    id: "f0",
    anchor: {
      sectionIndex: 0,
      paragraphIndex: 0,
      horizontalFrom: "margin",
      verticalFrom: "paragraph",
    },
    offsetXEmu: 914400,
    offsetYEmu: 457200,
    widthEmu: 1828800,
    heightEmu: 914400,
    content: { kind: "picture", partPath: "word/media/image1.png" },
    ...overrides,
  };
}

async function roundTrip(doc: SobreeDocument): Promise<SobreeDocument> {
  return (await importDocx(exportDocx(doc).bytes)).document;
}

describe("anchored frame export round-trip", () => {
  it("round-trips an anchored picture: origin, offsets, size, wrap, distances, behindDoc", async () => {
    const doc = baseDoc();
    doc.anchoredFrames = [
      frame({
        wrap: "square",
        wrapText: "left",
        behindText: true,
        textDistancesEmu: { topEmu: 0, rightEmu: 114300, bottomEmu: 0, leftEmu: 114300 },
      }),
    ];

    const back = await roundTrip(doc);

    // behindText excludes it from float conversion, so it stays a frame.
    expect(back.anchoredFrames).toHaveLength(1);
    const f = back.anchoredFrames![0]!;
    expect(f).toMatchObject({
      offsetXEmu: 914400,
      offsetYEmu: 457200,
      widthEmu: 1828800,
      heightEmu: 914400,
      behindText: true,
      wrap: "square",
      wrapText: "left",
      textDistancesEmu: { topEmu: 0, rightEmu: 114300, bottomEmu: 0, leftEmu: 114300 },
    });
    expect(f.anchor).toMatchObject({
      paragraphIndex: 0,
      horizontalFrom: "margin",
      verticalFrom: "paragraph",
    });
    expect(f.content).toMatchObject({ kind: "picture", partPath: "word/media/image1.png" });
  });

  it("a wrapping non-behind picture round-trips into the float run the importer produces", async () => {
    const doc = baseDoc();
    doc.anchoredFrames = [frame({ wrap: "square", wrapText: "right" })];

    const back = await roundTrip(doc);

    // floatWrappingImages claims it out of the overlay — same as importing
    // the original Word file would. The image itself must survive.
    expect(back.anchoredFrames ?? []).toHaveLength(0);
    const host = back.body[0] as Paragraph;
    expect(host.runs[0]).toMatchObject({ kind: "drawing", placement: "floatLeft" });
  });

  it("round-trips a textbox: body, fill, border, padding, rounded geometry", async () => {
    const doc = baseDoc();
    doc.anchoredFrames = [
      frame({
        content: {
          kind: "textbox",
          body: [paragraph([text("boxed words")])],
          fill: "#DDEEFF",
          border: { color: "#112233", widthEmu: 12700, style: "dashed" },
          padding: { topEmu: 45720, rightEmu: 91440, bottomEmu: 45720, leftEmu: 91440 },
          geometry: "roundedRect",
        },
      }),
    ];

    const back = await roundTrip(doc);

    expect(back.anchoredFrames).toHaveLength(1);
    const c = back.anchoredFrames![0]!.content;
    expect(c).toMatchObject({
      kind: "textbox",
      fill: "#DDEEFF",
      border: { color: "#112233", widthEmu: 12700, style: "dashed" },
      padding: { topEmu: 45720, rightEmu: 91440, bottomEmu: 45720, leftEmu: 91440 },
      geometry: "roundedRect",
    });
    const body = (c as { body: Paragraph[] }).body;
    expect(body[0]!.runs[0]).toMatchObject({ kind: "text", text: "boxed words" });
  });

  it("round-trips a preset shape with fill and dotted border", async () => {
    const doc = baseDoc();
    doc.anchoredFrames = [
      frame({
        content: {
          kind: "shape",
          geometry: "ellipse",
          fill: "#FF8800",
          border: { color: "#004400", widthEmu: 25400, style: "dotted" },
        },
      }),
    ];

    const back = await roundTrip(doc);

    expect(back.anchoredFrames![0]!.content).toMatchObject({
      kind: "shape",
      geometry: "ellipse",
      fill: "#FF8800",
      border: { color: "#004400", widthEmu: 25400, style: "dotted" },
    });
  });

  it("round-trips the alignment positioning form", async () => {
    const doc = baseDoc();
    doc.anchoredFrames = [
      frame({ alignH: "center", alignV: "bottom", offsetXEmu: 0, offsetYEmu: 0, behindText: true }),
    ];

    const back = await roundTrip(doc);

    expect(back.anchoredFrames![0]!).toMatchObject({ alignH: "center", alignV: "bottom" });
  });

  it("round-trips the percent position and percent size forms", async () => {
    const doc = baseDoc();
    doc.anchoredFrames = [
      frame({
        pctPosY: 1,
        pctWidth: 0.5,
        pctWidthFrom: "page",
        pctHeight: 0.25,
        pctHeightFrom: "margin",
        behindText: true,
      }),
    ];

    const back = await roundTrip(doc);

    expect(back.anchoredFrames![0]!).toMatchObject({
      pctPosY: 1,
      pctWidth: 0.5,
      pctWidthFrom: "page",
      pctHeight: 0.25,
      pctHeightFrom: "margin",
    });
  });

  it("keeps the tight wrap TAG through the synthesized rectangle polygon", async () => {
    const doc = baseDoc();
    doc.anchoredFrames = [frame({ wrap: "tight", behindText: true })];

    const back = await roundTrip(doc);

    expect(back.anchoredFrames![0]!.wrap).toBe("tight");
  });

  it("a frame with NO wrap stays wrap-less (no synthesized wrapNone)", async () => {
    const doc = baseDoc();
    doc.anchoredFrames = [frame({ behindText: true })];

    const back = await roundTrip(doc);

    expect(back.anchoredFrames![0]!.wrap).toBeUndefined();
    expect(back.anchoredFrames![0]!.textDistancesEmu).toBeUndefined();
  });

  it("attaches to the declared host paragraph, and the index survives", async () => {
    const doc = baseDoc();
    doc.anchoredFrames = [
      frame({
        anchor: {
          sectionIndex: 0,
          paragraphIndex: 1,
          horizontalFrom: "column",
          verticalFrom: "paragraph",
        },
        behindText: true,
      }),
    ];

    const back = await roundTrip(doc);

    expect(back.anchoredFrames![0]!.anchor).toMatchObject({
      paragraphIndex: 1,
      horizontalFrom: "column",
    });
  });

  it("skips GROUP frames without corrupting the package (documented gap)", async () => {
    const doc = baseDoc();
    doc.anchoredFrames = [
      frame({
        content: { kind: "group", children: [], childCoordSystemCx: 100, childCoordSystemCy: 100 },
      }),
      frame({ id: "f1", behindText: true }),
    ];

    const back = await roundTrip(doc);

    // The group is dropped (gap), the sibling picture survives.
    expect(back.anchoredFrames).toHaveLength(1);
    expect(back.anchoredFrames![0]!.content.kind).toBe("picture");
    expect((back.body[0] as Paragraph).runs.some((r) => r.kind === "text")).toBe(true);
  });
});
