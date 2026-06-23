import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { paragraph, text } from "../doc/builders";
import { emptyDocument } from "../doc/builders";
import type { AnchoredFrame, Paragraph, SobreeDocument } from "../doc/types";
import { applyDocumentToYDoc, projectYDoc, seedYDoc } from "./index";
import { Y_META_FIELDS, Y_META_KEY } from "./schema";

// Tier 2 floating layer: each anchored frame is its own Y.Map (textbox body
// reuses the block content codec), so concurrent edits to DIFFERENT frames
// merge instead of clobbering the whole `anchoredFrames` JSON blob.

const IDS = ["b0"];

function textboxFrame(id: string, body: string): AnchoredFrame {
  return {
    id,
    anchor: { sectionIndex: 0, horizontalFrom: "page", verticalFrom: "page" },
    offsetXEmu: 0,
    offsetYEmu: 0,
    widthEmu: 914400,
    heightEmu: 914400,
    content: { kind: "textbox", body: [paragraph([text(body)])] },
  };
}

function frameDoc(): SobreeDocument {
  const doc = emptyDocument();
  doc.body = [paragraph([text("body")])];
  doc.anchoredFrames = [textboxFrame("f0", "alpha"), textboxFrame("f1", "beta")];
  return doc;
}

function clone(doc: SobreeDocument): SobreeDocument {
  return JSON.parse(JSON.stringify(doc)) as SobreeDocument;
}

function frameText(doc: SobreeDocument, i: number): string {
  const frame = doc.anchoredFrames![i]!;
  if (frame.content.kind !== "textbox") return "";
  const para = frame.content.body[0] as Paragraph;
  return para.runs.map((r) => (r.kind === "text" ? r.text : "")).join("");
}

describe("frame Tier 2 — concurrent frame editing merges", () => {
  it("two peers editing DIFFERENT frames both survive", () => {
    const ydocA = new Y.Doc();
    seedYDoc(ydocA, frameDoc(), IDS);
    const ydocB = new Y.Doc();
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA));

    const vecA = Y.encodeStateVector(ydocA);
    const vecB = Y.encodeStateVector(ydocB);

    // A retypes frame 0; B retypes frame 1 — disjoint frames.
    const docA = clone(projectYDoc(ydocA).doc);
    (docA.anchoredFrames![0]!.content as { kind: "textbox"; body: unknown }).body = [
      paragraph([text("ALPHA-EDIT")]),
    ];
    applyDocumentToYDoc(ydocA, docA, IDS, "local");

    const docB = clone(projectYDoc(ydocB).doc);
    (docB.anchoredFrames![1]!.content as { kind: "textbox"; body: unknown }).body = [
      paragraph([text("BETA-EDIT")]),
    ];
    applyDocumentToYDoc(ydocB, docB, IDS, "local");

    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA, vecB));
    Y.applyUpdate(ydocA, Y.encodeStateAsUpdate(ydocB, vecA));

    const finalA = projectYDoc(ydocA).doc;
    expect(finalA).toEqual(projectYDoc(ydocB).doc); // converged
    expect(frameText(finalA, 0)).toBe("ALPHA-EDIT"); // A's edit survived
    expect(frameText(finalA, 1)).toBe("BETA-EDIT"); // B's edit survived
  });
});

describe("frame Tier 2 — legacy `meta` migration", () => {
  it("projects a pre-Phase-1c meta JSON blob, then upgrades the root on edit", () => {
    // Seed a normal doc (no frames), then hand-write the legacy meta blob and
    // leave the frame root empty — exactly the pre-Tier-2 floating layer.
    const ydoc = new Y.Doc();
    const base = emptyDocument();
    base.body = [paragraph([text("body")])];
    seedYDoc(ydoc, base, IDS);
    const legacy = [textboxFrame("f0", "legacy")];
    ydoc.transact(() => {
      ydoc.getMap<string>(Y_META_KEY).set(Y_META_FIELDS.anchoredFrames, JSON.stringify(legacy));
    }, "seed");

    // Reads via the meta fallback.
    expect(projectYDoc(ydoc).doc.anchoredFrames).toEqual(legacy);

    // First edit migrates to the nested root and clears the stale meta blob.
    const doc = clone(projectYDoc(ydoc).doc);
    (doc.anchoredFrames![0]!.content as { kind: "textbox"; body: unknown }).body = [
      paragraph([text("migrated")]),
    ];
    applyDocumentToYDoc(ydoc, doc, IDS, "local");

    expect(ydoc.getArray("anchoredFrames").length).toBe(1);
    expect(ydoc.getMap<string>(Y_META_KEY).has(Y_META_FIELDS.anchoredFrames)).toBe(false);
    expect(frameText(projectYDoc(ydoc).doc, 0)).toBe("migrated");
  });
});
