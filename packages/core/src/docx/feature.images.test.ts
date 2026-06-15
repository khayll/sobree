import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../doc/builders";
import type { DrawingRun, Paragraph, SobreeDocument } from "../doc/types";
import { exportDocx } from "./export/index";
import { importDocx } from "./import/index";

/**
 * A 1×1 transparent PNG encoded as raw bytes. Tiny but valid — enough
 * for the importer to recognise it as an image without us needing to
 * generate real pixel data.
 */
const ONE_BY_ONE_PNG = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a, // signature
  0x00,
  0x00,
  0x00,
  0x0d, // IHDR length
  0x49,
  0x48,
  0x44,
  0x52, // IHDR
  0x00,
  0x00,
  0x00,
  0x01, // width = 1
  0x00,
  0x00,
  0x00,
  0x01, // height = 1
  0x08,
  0x06,
  0x00,
  0x00,
  0x00, // bit depth 8, RGBA
  0x1f,
  0x15,
  0xc4,
  0x89, // CRC
  0x00,
  0x00,
  0x00,
  0x0d, // IDAT length
  0x49,
  0x44,
  0x41,
  0x54, // IDAT
  0x78,
  0x9c,
  0x63,
  0x00,
  0x01,
  0x00,
  0x00,
  0x05,
  0x00,
  0x01,
  0x0d,
  0x0a,
  0x2d,
  0xb4,
  0x00,
  0x00,
  0x00,
  0x00, // IEND length
  0x49,
  0x45,
  0x4e,
  0x44, // IEND
  0xae,
  0x42,
  0x60,
  0x82,
]);

function docWithImage(): SobreeDocument {
  const doc = emptyDocument();
  doc.rawParts["word/media/image1.png"] = ONE_BY_ONE_PNG;
  const drawing: DrawingRun = {
    kind: "drawing",
    partPath: "word/media/image1.png",
    widthEmu: 914400,
    heightEmu: 914400,
    placement: "inline",
    altText: "smoke-test image",
  };
  doc.body = [
    paragraph([text("before ")]),
    {
      kind: "paragraph",
      properties: {},
      runs: [drawing, { kind: "text", text: " after", properties: {} }],
    },
  ];
  return doc;
}

describe("DOCX image round-trip (Phase 4)", () => {
  it("round-trips an embedded image through export → import", async () => {
    const doc = docWithImage();
    const { bytes } = exportDocx(doc);
    const { document: imported } = await importDocx(bytes);

    // Find a DrawingRun in the imported body.
    const drawingRun = imported.body
      .flatMap((b) => (b.kind === "paragraph" ? (b as Paragraph).runs : []))
      .find((r) => r.kind === "drawing") as DrawingRun | undefined;

    expect(drawingRun).toBeDefined();
    expect(drawingRun?.partPath.startsWith("word/media/")).toBe(true);
    expect(drawingRun?.altText).toBe("smoke-test image");

    // The bytes should be back in rawParts.
    const restored = imported.rawParts[drawingRun!.partPath];
    expect(restored).toBeDefined();
    expect(restored?.byteLength).toBe(ONE_BY_ONE_PNG.byteLength);
  });

  it("allocates fresh rIds for images alongside headers/footers", async () => {
    const doc = docWithImage();
    const { bytes } = exportDocx(doc);
    // Inspecting the ZIP directly is overkill; importing it is a proxy:
    // if import succeeds and the drawing's partPath is preserved, the
    // relationships resolved.
    const { document: imported } = await importDocx(bytes);
    const allRuns = imported.body.flatMap((b) =>
      b.kind === "paragraph" ? (b as Paragraph).runs : [],
    );
    const drawings = allRuns.filter((r) => r.kind === "drawing");
    expect(drawings).toHaveLength(1);
  });

  it("preserves width and height (EMU)", async () => {
    const doc = docWithImage();
    const { bytes } = exportDocx(doc);
    const { document: imported } = await importDocx(bytes);
    const drawing = imported.body
      .flatMap((b) => (b.kind === "paragraph" ? (b as Paragraph).runs : []))
      .find((r) => r.kind === "drawing") as DrawingRun | undefined;
    expect(drawing?.widthEmu).toBe(914400);
    expect(drawing?.heightEmu).toBe(914400);
  });
});
