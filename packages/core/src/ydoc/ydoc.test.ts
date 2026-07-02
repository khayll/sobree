import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { appendBlock, emptyDocument, field, heading, paragraph, text } from "../doc/builders";
import type { AnchoredFrame, SobreeDocument } from "../doc/types";
import { applyDocumentToYDoc } from "./apply";
import { projectYDoc } from "./project";
import { seedYDoc } from "./seed";

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `b${i + 1}`);
}

function seedDoc(): SobreeDocument {
  const d = emptyDocument();
  appendBlock(d, heading(1, [text("Title")]));
  appendBlock(d, paragraph([text("Hello world.")]));
  return d;
}

describe("ydoc helpers", () => {
  it("seeds and projects round-trip", () => {
    const doc = seedDoc();
    const ydoc = new Y.Doc();
    seedYDoc(ydoc, doc, ids(doc.body.length));

    const { doc: out, ids: outIds } = projectYDoc(ydoc);
    expect(out.body).toEqual(doc.body);
    expect(outIds).toEqual(ids(doc.body.length));
    expect(out.sections).toEqual(doc.sections);
    expect(out.styles).toEqual(doc.styles);
  });

  it("round-trips a heading style's outline numbering (NamedStyle.numbering)", () => {
    const doc = seedDoc();
    doc.styles.push({
      id: "OutlineHead",
      type: "paragraph",
      displayName: "Outline Head",
      basedOn: "Heading1",
      numbering: { numId: 14, level: 0 },
    });
    const ydoc = new Y.Doc();
    seedYDoc(ydoc, doc, ids(doc.body.length));
    const { doc: out } = projectYDoc(ydoc);
    expect(out.styles.find((s) => s.id === "OutlineHead")?.numbering).toEqual({
      numId: 14,
      level: 0,
    });
  });

  it("round-trips the floating layer (anchoredFrames + headerFooterFrames)", () => {
    const doc = seedDoc();
    const shape = (id: string): AnchoredFrame => ({
      id,
      anchor: {
        sectionIndex: 0,
        verticalFrom: "paragraph",
        horizontalFrom: "column",
        paragraphIndex: 0,
      },
      offsetXEmu: 100,
      offsetYEmu: 200,
      widthEmu: 300,
      heightEmu: 400,
      content: { kind: "shape", geometry: "rect" },
    });
    doc.anchoredFrames = [shape("body-1")];
    doc.headerFooterFrames = { "header1.xml": [shape("hdr-1")] };

    const ydoc = new Y.Doc();
    seedYDoc(ydoc, doc, ids(doc.body.length));
    const { doc: out } = projectYDoc(ydoc);

    // Without persisting the floating layer, these vanish on reload —
    // exactly the "refresh drops the header textbox + photo" bug.
    expect(out.anchoredFrames).toEqual(doc.anchoredFrames);
    expect(out.headerFooterFrames).toEqual(doc.headerFooterFrames);
  });

  it("round-trips FieldRun in headerFooterBodies (Page {PAGE} of {NUMPAGES})", () => {
    const doc = seedDoc();
    doc.headerFooterBodies = {
      "footer1.xml": [
        paragraph([text("Page "), field("PAGE"), text(" of "), field("NUMPAGES", "2")]),
      ],
    };

    const ydoc = new Y.Doc();
    seedYDoc(ydoc, doc, ids(doc.body.length));
    const { doc: out } = projectYDoc(ydoc);

    // A refresh / collab join renders the footer from this projection —
    // the live page-number substitution dies if the instruction is lost.
    expect(out.headerFooterBodies).toEqual(doc.headerFooterBodies);
  });

  it("round-trips footnotes, comments and settings", () => {
    const doc = seedDoc();
    doc.footnotes = { 1: [paragraph([text("A footnote body.")])] };
    doc.comments = { 7: { id: 7, author: "Alice", body: [paragraph([text("A note.")])] } };
    doc.settings = { defaultTabStopTwips: 540 };

    const ydoc = new Y.Doc();
    seedYDoc(ydoc, doc, ids(doc.body.length));
    const { doc: out } = projectYDoc(ydoc);

    // These also rode only on the in-memory doc and vanished on refresh.
    expect(out.footnotes).toEqual(doc.footnotes);
    expect(out.comments).toEqual(doc.comments);
    expect(out.settings).toEqual(doc.settings);
  });

  it("round-trips settings that carry no defaultTabStop (page background, noColumnBalance)", () => {
    // The projection gated `settings` on `defaultTabStopTwips`, so a doc whose
    // only settings were a page background or noColumnBalance lost them on
    // refresh / collab join. Both must survive without a default tab stop.
    const doc = seedDoc();
    doc.settings = { pageBackgroundColor: "#FFCC99", noColumnBalance: true };

    const ydoc = new Y.Doc();
    seedYDoc(ydoc, doc, ids(doc.body.length));
    const { doc: out } = projectYDoc(ydoc);

    expect(out.settings).toEqual(doc.settings);
  });

  it("applyDocumentToYDoc updates a single block in place", () => {
    const doc = seedDoc();
    const ydoc = new Y.Doc();
    seedYDoc(ydoc, doc, ids(doc.body.length));

    const next: SobreeDocument = {
      ...doc,
      body: [
        doc.body[0]!, // heading unchanged
        paragraph([text("Hello, modified.")]),
      ],
    };
    applyDocumentToYDoc(ydoc, next, ids(2));

    const { doc: out } = projectYDoc(ydoc);
    expect(out.body).toEqual(next.body);
  });

  it("applyDocumentToYDoc inserts a new block", () => {
    const doc = seedDoc();
    const ydoc = new Y.Doc();
    seedYDoc(ydoc, doc, ids(doc.body.length));

    const inserted = paragraph([text("Inserted.")]);
    const next: SobreeDocument = {
      ...doc,
      body: [doc.body[0]!, inserted, doc.body[1]!],
    };
    applyDocumentToYDoc(ydoc, next, ["b1", "b3", "b2"]);

    const { doc: out, ids: outIds } = projectYDoc(ydoc);
    expect(out.body).toEqual(next.body);
    expect(outIds).toEqual(["b1", "b3", "b2"]);
  });

  it("applyDocumentToYDoc deletes a block", () => {
    const doc = seedDoc();
    const ydoc = new Y.Doc();
    seedYDoc(ydoc, doc, ids(doc.body.length));

    const next: SobreeDocument = { ...doc, body: [doc.body[0]!] };
    applyDocumentToYDoc(ydoc, next, ["b1"]);

    const { doc: out, ids: outIds } = projectYDoc(ydoc);
    expect(out.body).toEqual(next.body);
    expect(outIds).toEqual(["b1"]);
  });

  it("applyDocumentToYDoc preserves block Y.Map identity for unchanged blocks", () => {
    const doc = seedDoc();
    const ydoc = new Y.Doc();
    seedYDoc(ydoc, doc, ids(doc.body.length));

    const body = ydoc.getArray<Y.Map<unknown>>("body");
    const beforeHeading = body.get(0);
    const beforePara = body.get(1);

    // Modify only the paragraph; heading should keep its Y.Map identity.
    const next: SobreeDocument = {
      ...doc,
      body: [doc.body[0]!, paragraph([text("Modified.")])],
    };
    applyDocumentToYDoc(ydoc, next, ["b1", "b2"]);

    expect(body.get(0)).toBe(beforeHeading);
    // Paragraph Y.Map identity preserved (only its _ast field changed).
    expect(body.get(1)).toBe(beforePara);
  });

  it("origin is propagated through transactions", () => {
    const doc = seedDoc();
    const ydoc = new Y.Doc();
    const seenOrigins: unknown[] = [];
    ydoc.on("afterTransaction", (tr: Y.Transaction) => {
      seenOrigins.push(tr.origin);
    });
    seedYDoc(ydoc, doc, ids(doc.body.length));
    applyDocumentToYDoc(ydoc, { ...doc, body: [doc.body[0]!] }, ["b1"], "test-origin");
    expect(seenOrigins).toContain("seed");
    expect(seenOrigins).toContain("test-origin");
  });

  it("rawParts: Uint8Array round-trip", () => {
    const doc = emptyDocument();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    doc.rawParts["word/media/img1.png"] = bytes;
    appendBlock(doc, paragraph([text("doc with image")]));

    const ydoc = new Y.Doc();
    seedYDoc(ydoc, doc, ids(doc.body.length));
    const { doc: out } = projectYDoc(ydoc);

    expect(out.rawParts["word/media/img1.png"]).toEqual(bytes);
  });

  // === Phase 3.2 — partRefs ===

  it("projectYDoc returns empty partRefs when none are set", () => {
    const doc = seedDoc();
    const ydoc = new Y.Doc();
    seedYDoc(ydoc, doc, ids(doc.body.length));

    const result = projectYDoc(ydoc);
    expect(result.partRefs).toEqual({});
  });

  it("partRefs round-trip through applyPartRefsToYDoc + projectYDoc", async () => {
    const doc = seedDoc();
    const ydoc = new Y.Doc();
    seedYDoc(ydoc, doc, ids(doc.body.length));

    const { applyPartRefsToYDoc } = await import("./apply");
    applyPartRefsToYDoc(ydoc, {
      "word/media/image1.png": "a".repeat(64),
      "word/media/image2.png": "b".repeat(64),
    });

    const result = projectYDoc(ydoc);
    expect(result.partRefs).toEqual({
      "word/media/image1.png": "a".repeat(64),
      "word/media/image2.png": "b".repeat(64),
    });
  });

  it("removePartRefsFromYDoc deletes specified entries", async () => {
    const doc = seedDoc();
    const ydoc = new Y.Doc();
    seedYDoc(ydoc, doc, ids(doc.body.length));

    const { applyPartRefsToYDoc, removePartRefsFromYDoc } = await import("./apply");
    applyPartRefsToYDoc(ydoc, {
      keep: "a".repeat(64),
      drop: "b".repeat(64),
    });
    removePartRefsFromYDoc(ydoc, ["drop"]);
    const result = projectYDoc(ydoc);
    expect(result.partRefs).toEqual({ keep: "a".repeat(64) });
  });

  it("parts (inline) and partRefs coexist in the same Y.Doc", async () => {
    const doc = emptyDocument();
    const bytes = new Uint8Array([1, 2, 3]);
    doc.rawParts["word/media/inline.png"] = bytes;

    const ydoc = new Y.Doc();
    seedYDoc(ydoc, doc, ids(doc.body.length));
    const { applyPartRefsToYDoc } = await import("./apply");
    applyPartRefsToYDoc(ydoc, {
      "word/media/hashed.png": "c".repeat(64),
    });

    const result = projectYDoc(ydoc);
    // Inline bytes show up in rawParts; hash entries in partRefs.
    expect(result.doc.rawParts["word/media/inline.png"]).toEqual(bytes);
    expect(result.partRefs["word/media/hashed.png"]).toBe("c".repeat(64));
    // The two don't cross-contaminate.
    expect(result.doc.rawParts["word/media/hashed.png"]).toBeUndefined();
    expect(result.partRefs["word/media/inline.png"]).toBeUndefined();
  });
});
