import { describe, expect, it } from "vitest";
import { emptyDocument } from "./builders";
import { collectLivePartPaths, pruneOrphanParts } from "./parts";
import type { AnchoredFrame, Block, DrawingRun, Paragraph, SobreeDocument } from "./types";

/** Geometry-only frame fields; content is supplied per-test. */
function frameShell(): Omit<AnchoredFrame, "content"> {
  return {
    id: "f",
    anchor: { sectionIndex: 0, horizontalFrom: "page", verticalFrom: "page" },
    offsetXEmu: 0,
    offsetYEmu: 0,
    widthEmu: 100,
    heightEmu: 100,
  };
}

function pictureFrame(partPath: string): AnchoredFrame {
  return { ...frameShell(), content: { kind: "picture", partPath } };
}

function drawing(partPath: string): DrawingRun {
  return {
    kind: "drawing",
    partPath,
    widthEmu: 1,
    heightEmu: 1,
    placement: "inline",
  };
}

function paraWithImage(partPath: string): Paragraph {
  return {
    kind: "paragraph",
    properties: {},
    runs: [drawing(partPath)],
  };
}

function makeDoc(body: Block[]): SobreeDocument {
  return { ...emptyDocument(), body };
}

describe("collectLivePartPaths", () => {
  it("returns empty set for a doc with no drawings", () => {
    const doc = makeDoc([
      {
        kind: "paragraph",
        properties: {},
        runs: [{ kind: "text", text: "hi", properties: {} }],
      },
    ]);
    expect(collectLivePartPaths(doc)).toEqual(new Set());
  });

  it("collects partPaths from inline drawings in body paragraphs", () => {
    const doc = makeDoc([paraWithImage("word/media/image1.png")]);
    expect(collectLivePartPaths(doc)).toEqual(new Set(["word/media/image1.png"]));
  });

  it("collects across multiple drawings, deduplicated", () => {
    const doc = makeDoc([
      paraWithImage("word/media/image1.png"),
      paraWithImage("word/media/image1.png"), // dupe
      paraWithImage("word/media/image2.jpg"),
    ]);
    expect(collectLivePartPaths(doc)).toEqual(
      new Set(["word/media/image1.png", "word/media/image2.jpg"]),
    );
  });

  it("descends into table cells", () => {
    const doc = makeDoc([
      {
        kind: "table",
        grid: [3000],
        rows: [
          {
            cells: [{ content: [paraWithImage("word/media/cell.png")] }],
          },
        ],
        properties: {},
      },
    ]);
    expect(collectLivePartPaths(doc)).toEqual(new Set(["word/media/cell.png"]));
  });

  it("descends into header/footer templates", () => {
    const doc = makeDoc([]);
    doc.headerFooterBodies["header1.xml"] = [paraWithImage("word/media/logo.png")];
    expect(collectLivePartPaths(doc)).toEqual(new Set(["word/media/logo.png"]));
  });

  it("collects picture paths from body anchored frames", () => {
    const doc = makeDoc([]);
    doc.anchoredFrames = [pictureFrame("word/media/float.png")];
    expect(collectLivePartPaths(doc)).toEqual(new Set(["word/media/float.png"]));
  });

  it("collects picture paths from header/footer frames (incl. nested + textbox)", () => {
    const doc = makeDoc([]);
    doc.headerFooterFrames = {
      "header1.xml": [
        pictureFrame("word/media/headerlogo.png"),
        {
          ...frameShell(),
          content: { kind: "textbox", body: [paraWithImage("word/media/intbx.png")] },
        },
        {
          ...frameShell(),
          content: {
            kind: "group",
            children: [pictureFrame("word/media/grpchild.png")],
            childCoordSystemCx: 100,
            childCoordSystemCy: 100,
          },
        },
      ],
    };
    expect(collectLivePartPaths(doc)).toEqual(
      new Set(["word/media/headerlogo.png", "word/media/intbx.png", "word/media/grpchild.png"]),
    );
  });
});

describe("pruneOrphanParts", () => {
  it("drops rawParts entries that no DrawingRun references", () => {
    const doc = makeDoc([paraWithImage("word/media/keep.png")]);
    doc.rawParts["word/media/keep.png"] = new Uint8Array([1, 2, 3]);
    doc.rawParts["word/media/orphan.png"] = new Uint8Array([9, 9, 9]);

    const result = pruneOrphanParts(doc);
    expect(result.pruned).toEqual(["word/media/orphan.png"]);
    expect(result.kept).toBe(1);
    expect(Object.keys(result.doc.rawParts)).toEqual(["word/media/keep.png"]);
  });

  it("is idempotent — clean doc returns same instance", () => {
    const doc = makeDoc([paraWithImage("word/media/keep.png")]);
    doc.rawParts["word/media/keep.png"] = new Uint8Array([1]);
    const result = pruneOrphanParts(doc);
    expect(result.pruned).toEqual([]);
    expect(result.kept).toBe(1);
    // Pruning a clean doc returns the same SobreeDocument reference
    // (avoids unnecessary churn in downstream subscribers).
    expect(result.doc).toBe(doc);
  });

  it("preserves header/footer images on prune", () => {
    const doc = makeDoc([]);
    doc.headerFooterBodies["header1.xml"] = [paraWithImage("word/media/h.png")];
    doc.rawParts["word/media/h.png"] = new Uint8Array([1]);
    doc.rawParts["word/media/zombie.jpg"] = new Uint8Array([2]);
    const result = pruneOrphanParts(doc);
    expect(result.pruned).toEqual(["word/media/zombie.jpg"]);
    expect(Object.keys(result.doc.rawParts)).toEqual(["word/media/h.png"]);
  });

  it("preserves a header anchored-frame picture on prune", () => {
    const doc = makeDoc([]);
    doc.headerFooterFrames = {
      "header1.xml": [pictureFrame("word/media/badge.png")],
    };
    doc.rawParts["word/media/badge.png"] = new Uint8Array([1]);
    doc.rawParts["word/media/zombie.jpg"] = new Uint8Array([2]);
    const result = pruneOrphanParts(doc);
    expect(result.pruned).toEqual(["word/media/zombie.jpg"]);
    expect(Object.keys(result.doc.rawParts)).toEqual(["word/media/badge.png"]);
  });
});
