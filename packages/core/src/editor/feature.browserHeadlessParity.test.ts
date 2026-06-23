/**
 * Browser/headless mutation parity.
 *
 * The browser `Editor` and `HeadlessSobree` route their block / paragraph /
 * section / style / numbering mutations through the same pure engine
 * (`doc/mutations`). These tests pin that they STAY in sync: the same public
 * call on each peer must produce the same document — both in memory and
 * after a Y.Doc encode → fresh-doc → project reload (the path a refreshing
 * tab or a joining collab peer actually renders from).
 */

import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  appendBlock,
  bulletDefinition,
  defaultSection,
  emptyDocument,
  namedStyle,
  numberingDefinition,
  numberingLevel,
  paragraph,
  text,
} from "../doc/builders";
import type { SectionBreak, SobreeDocument } from "../doc/types";
import { HeadlessSobree } from "../headless";
import { projectYDoc } from "../ydoc";
import { Editor } from "./";

// === harness ===

interface Peers {
  editor: Editor;
  headless: HeadlessSobree;
}

const cleanups: Array<() => void> = [];

function peers(doc: SobreeDocument): Peers {
  const host = document.createElement("div");
  document.body.appendChild(host);
  // Each peer gets its own clone — the Editor mutates the doc it's handed,
  // and the two seed independent Y.Docs.
  const editor = new Editor(host, { initialDocument: structuredClone(doc) });
  const headless = new HeadlessSobree(new Y.Doc(), { initialDocument: structuredClone(doc) });
  cleanups.push(() => {
    editor.destroy();
    headless.destroy();
    host.remove();
  });
  return { editor, headless };
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/** Project a fresh Y.Doc seeded from `ydoc`'s encoded state — the reload a
 *  refreshing tab / joining peer renders from. */
function reload(ydoc: Y.Doc): SobreeDocument {
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, Y.encodeStateAsUpdate(ydoc));
  return projectYDoc(fresh).doc;
}

/** Compare the document content that block ids don't live in: body,
 *  sections, styles, numbering. (Block ids differ per peer — they live in
 *  the registry, not the AST.) */
function expectDocsEqual(a: SobreeDocument, b: SobreeDocument): void {
  expect(a.body).toEqual(b.body);
  expect(a.sections).toEqual(b.sections);
  expect(a.styles).toEqual(b.styles);
  expect(a.numbering).toEqual(b.numbering);
}

/** Assert full browser/headless parity: in-memory and after Y.Doc reload. */
function expectParity({ editor, headless }: Peers): void {
  expectDocsEqual(editor.getDocument(), headless.getDocument());
  expectDocsEqual(reload(editor.ydoc), reload(headless.ydoc));
}

// === fixtures ===

function threeParaDoc(): SobreeDocument {
  const d = emptyDocument();
  d.body = [];
  appendBlock(d, paragraph([text("one")]));
  appendBlock(d, paragraph([text("two")]));
  appendBlock(d, paragraph([text("three")]));
  return d;
}

function singleParaDoc(): SobreeDocument {
  const d = emptyDocument();
  d.body = [];
  appendBlock(d, paragraph([text("only")]));
  return d;
}

function twoSectionDoc(): SobreeDocument {
  const d = emptyDocument();
  d.body = [];
  appendBlock(d, paragraph([text("title")]));
  const sb: SectionBreak = { kind: "section_break", toSectionIndex: 1 };
  appendBlock(d, sb);
  appendBlock(d, paragraph([text("chapter")]));
  d.sections = [
    { ...defaultSection(), vAlign: "center", titlePage: true },
    { ...defaultSection() },
  ];
  return d;
}

// === block mutations ===

describe("block parity", () => {
  it("replaceBlock — paragraph in place", () => {
    const p = peers(threeParaDoc());
    const repl = paragraph([text("replaced")]);
    expect(p.editor.replaceBlock(p.editor.getBlock(1), structuredClone(repl)).ok).toBe(true);
    expect(p.headless.replaceBlock(p.headless.getBlock(1), structuredClone(repl)).ok).toBe(true);
    expectParity(p);
  });

  it("insertBlockBefore — paragraph before target", () => {
    const p = peers(threeParaDoc());
    const ins = paragraph([text("inserted")]);
    expect(p.editor.insertBlockBefore(p.editor.getBlock(1), structuredClone(ins)).ok).toBe(true);
    expect(p.headless.insertBlockBefore(p.headless.getBlock(1), structuredClone(ins)).ok).toBe(
      true,
    );
    expectParity(p);
  });

  it("insertBlockAfter — paragraph after target", () => {
    const p = peers(threeParaDoc());
    const ins = paragraph([text("inserted")]);
    expect(p.editor.insertBlockAfter(p.editor.getBlock(1), structuredClone(ins)).ok).toBe(true);
    expect(p.headless.insertBlockAfter(p.headless.getBlock(1), structuredClone(ins)).ok).toBe(true);
    expectParity(p);
  });

  it("deleteBlock — middle block", () => {
    const p = peers(threeParaDoc());
    expect(p.editor.deleteBlock(p.editor.getBlock(1)).ok).toBe(true);
    expect(p.headless.deleteBlock(p.headless.getBlock(1)).ok).toBe(true);
    expectParity(p);
  });

  it("deleteBlock — only block leaves one empty paragraph", () => {
    const p = peers(singleParaDoc());
    expect(p.editor.deleteBlock(p.editor.getBlock(0)).ok).toBe(true);
    expect(p.headless.deleteBlock(p.headless.getBlock(0)).ok).toBe(true);
    expect(p.editor.getDocument().body).toEqual([{ kind: "paragraph", properties: {}, runs: [] }]);
    expectParity(p);
  });

  it("deleteBlock — section break merges the trailing section", () => {
    const p = peers(twoSectionDoc());
    expect(p.editor.getDocument().body[1]?.kind).toBe("section_break");
    expect(p.editor.deleteBlock(p.editor.getBlock(1)).ok).toBe(true);
    expect(p.headless.deleteBlock(p.headless.getBlock(1)).ok).toBe(true);
    expect(p.editor.getDocument().sections.length).toBe(1);
    expect(p.editor.getDocument().sections[0]?.vAlign).toBe("center");
    expectParity(p);
  });

  it("replaceBlock — section break → paragraph merges sections", () => {
    const p = peers(twoSectionDoc());
    const repl = paragraph([text("merged")]);
    expect(p.editor.replaceBlock(p.editor.getBlock(1), structuredClone(repl)).ok).toBe(true);
    expect(p.headless.replaceBlock(p.headless.getBlock(1), structuredClone(repl)).ok).toBe(true);
    expect(p.editor.getDocument().sections.length).toBe(1);
    expectParity(p);
  });

  it("applyBlockProperties — alignment", () => {
    const p = peers(threeParaDoc());
    expect(p.editor.applyBlockProperties([p.editor.getBlock(1)], { alignment: "center" }).ok).toBe(
      true,
    );
    expect(
      p.headless.applyBlockProperties([p.headless.getBlock(1)], { alignment: "center" }).ok,
    ).toBe(true);
    expectParity(p);
  });

  it("stale ref fails identically on both peers", () => {
    const p = peers(threeParaDoc());
    const eStale = p.editor.getBlock(1);
    const hStale = p.headless.getBlock(1);
    p.editor.applyBlockProperties([p.editor.getBlock(1)], { alignment: "center" });
    p.headless.applyBlockProperties([p.headless.getBlock(1)], { alignment: "center" });
    const eRes = p.editor.applyBlockProperties([eStale], { alignment: "right" });
    const hRes = p.headless.applyBlockProperties([hStale], { alignment: "right" });
    expect(eRes.ok).toBe(false);
    expect(hRes.ok).toBe(false);
    if (!eRes.ok && !hRes.ok) expect(eRes.error.code).toBe(hRes.error.code);
  });
});

// === section properties ===

describe("section parity", () => {
  it("applySectionProperties — page margins + vAlign", () => {
    const p = peers(threeParaDoc());
    const patch = { pageMargins: { topTwips: 2000 }, vAlign: "center" } as const;
    expect(p.editor.sections.setProperties(0, patch).ok).toBe(true);
    expect(p.headless.applySectionProperties(0, patch).ok).toBe(true);
    expectParity(p);
  });
});

// === styles ===

describe("style parity", () => {
  it("define / update / remove", () => {
    const p = peers(threeParaDoc());
    const style = namedStyle("PullQuote", { displayName: "Pull Quote", basedOn: "Normal" });
    expect(p.editor.styles.define(structuredClone(style)).ok).toBe(true);
    expect(p.headless.defineStyle(structuredClone(style)).ok).toBe(true);
    expectParity(p);

    expect(p.editor.styles.update("PullQuote", { displayName: "Block Quote" }).ok).toBe(true);
    expect(p.headless.updateStyle("PullQuote", { displayName: "Block Quote" }).ok).toBe(true);
    expectParity(p);

    expect(p.editor.styles.remove("PullQuote").ok).toBe(true);
    expect(p.headless.removeStyle("PullQuote").ok).toBe(true);
    expectParity(p);
  });
});

// === numbering ===

describe("numbering parity", () => {
  it("define / update / remove", () => {
    const p = peers(threeParaDoc());
    const def = bulletDefinition(7);
    expect(p.editor.numbering.define(structuredClone(def)).ok).toBe(true);
    expect(p.headless.defineNumbering(structuredClone(def)).ok).toBe(true);
    expectParity(p);

    const levels = [numberingLevel(0, "decimal", "%1.")];
    expect(p.editor.numbering.update(7, structuredClone(levels)).ok).toBe(true);
    expect(p.headless.updateNumbering(7, structuredClone(levels)).ok).toBe(true);
    expectParity(p);

    expect(p.editor.numbering.remove(7).ok).toBe(true);
    expect(p.headless.removeNumbering(7).ok).toBe(true);
    expectParity(p);
  });

  it("define rejects a duplicate numId identically", () => {
    const p = peers(threeParaDoc());
    const def = numberingDefinition(3, [numberingLevel(0, "decimal", "%1.")]);
    p.editor.numbering.define(structuredClone(def));
    p.headless.defineNumbering(structuredClone(def));
    expect(p.editor.numbering.define(structuredClone(def)).ok).toBe(false);
    expect(p.headless.defineNumbering(structuredClone(def)).ok).toBe(false);
  });
});
