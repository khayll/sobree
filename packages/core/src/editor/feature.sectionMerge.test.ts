import { appendBlock, defaultSection, emptyDocument, paragraph, text } from "../doc/builders";
import type { SectionBreak, SectionProperties, SobreeDocument } from "../doc/types";
import { Editor } from "./";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function twoSectionDoc(): SobreeDocument {
  // Body: P, P, SectionBreak, P, P
  // Sections: [section0, section1]
  const d = emptyDocument();
  d.body = [];
  appendBlock(d, paragraph([text("title")]));
  appendBlock(d, paragraph([text("subtitle")]));
  const sb: SectionBreak = { kind: "section_break", toSectionIndex: 1 };
  appendBlock(d, sb);
  appendBlock(d, paragraph([text("chapter")]));
  appendBlock(d, paragraph([text("body")]));
  d.sections = [
    { ...defaultSection(), vAlign: "center", titlePage: true },
    { ...defaultSection() },
  ];
  return d;
}

function setupEditor(): { ed: Editor } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return { ed: new Editor(host, { initialDocument: twoSectionDoc() }) };
}

describe("editor: section merging on SectionBreak removal", () => {
  let ed: Editor;
  beforeEach(() => {
    ({ ed } = setupEditor());
  });
  afterEach(() => {
    ed.destroy();
  });

  it("seed: body has 5 blocks and sections has 2 entries", () => {
    const doc = ed.getDocument();
    expect(doc.body.length).toBe(5);
    expect(doc.body[2]?.kind).toBe("section_break");
    expect(doc.sections.length).toBe(2);
  });

  it("deleteBlock on the SectionBreak merges the trailing section", () => {
    const breakRef = ed.getBlock(2);
    const r = ed.deleteBlock(breakRef);
    expect(r.ok).toBe(true);

    const doc = ed.getDocument();
    expect(doc.sections.length).toBe(1);
    // The earlier section's properties survive — the trailing section
    // is the one that's dropped.
    expect(doc.sections[0]?.vAlign).toBe("center");
    expect(doc.sections[0]?.titlePage).toBe(true);
    // Body is now 4 blocks, no SectionBreak.
    expect(doc.body.length).toBe(4);
    expect(doc.body.find((b) => b.kind === "section_break")).toBeUndefined();
  });

  it("replaceBlock(SectionBreak → paragraph) merges the trailing section", () => {
    const breakRef = ed.getBlock(2);
    const r = ed.replaceBlock(breakRef, paragraph([text("merged here")]));
    expect(r.ok).toBe(true);

    const doc = ed.getDocument();
    expect(doc.sections.length).toBe(1);
    expect(doc.sections[0]?.vAlign).toBe("center");
    // The break is gone, replaced by a paragraph.
    expect(doc.body[2]?.kind).toBe("paragraph");
  });

  it("replaceBlock(SectionBreak → SectionBreak) does NOT merge", () => {
    const breakRef = ed.getBlock(2);
    const replacement: SectionBreak = { kind: "section_break", toSectionIndex: 1 };
    const r = ed.replaceBlock(breakRef, replacement);
    expect(r.ok).toBe(true);

    const doc = ed.getDocument();
    // Still two sections; replacement is also a break.
    expect(doc.sections.length).toBe(2);
    expect(doc.body[2]?.kind).toBe("section_break");
  });

  it("merging the only break in a 3-section doc keeps the other section", () => {
    // Build a fresh 3-section doc: P, SB, P, SB, P → sections [A, B, C]
    const host = document.createElement("div");
    document.body.appendChild(host);
    const d = emptyDocument();
    d.body = [];
    appendBlock(d, paragraph([text("a")]));
    appendBlock(d, { kind: "section_break", toSectionIndex: 1 });
    appendBlock(d, paragraph([text("b")]));
    appendBlock(d, { kind: "section_break", toSectionIndex: 2 });
    appendBlock(d, paragraph([text("c")]));
    const sectionA: SectionProperties = { ...defaultSection(), vAlign: "center" };
    const sectionB: SectionProperties = { ...defaultSection(), vAlign: "bottom" };
    const sectionC: SectionProperties = { ...defaultSection(), vAlign: "top" };
    d.sections = [sectionA, sectionB, sectionC];
    const e = new Editor(host, { initialDocument: d });

    // Delete the FIRST SectionBreak (at body index 1) — sections A + B merge,
    // C survives. Earlier section (A)'s properties win.
    const firstBreak = e.getBlock(1);
    e.deleteBlock(firstBreak);

    const doc = e.getDocument();
    expect(doc.sections.length).toBe(2);
    expect(doc.sections[0]?.vAlign).toBe("center"); // A's properties
    expect(doc.sections[1]?.vAlign).toBe("top"); // C, untouched

    e.destroy();
  });
});
