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
import type { Range as ApiRange, BlockRef } from "../doc/api";
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
import type { RevisionSpan } from "../doc/mutations";
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

function commentDoc(): SobreeDocument {
  const d = emptyDocument();
  d.body = [];
  appendBlock(d, paragraph([text("hello")]));
  d.comments = { 1: { id: 1, author: "Ada", body: [paragraph([text("note")])], done: false } };
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

// === inline / range mutations ===

/** A model range over one block's `[from, to)` character offsets. A
 *  `BlockInfo` from `getBlock` satisfies `BlockRef` structurally. */
function mkRange(block: BlockRef, from: number, to: number): ApiRange {
  return { from: { block, offset: from }, to: { block, offset: to } };
}

/** True if any text run in `body[0]` carries a revision of `type`. */
function firstBlockHasRevision(doc: SobreeDocument, type: "ins" | "del"): boolean {
  const block = doc.body[0];
  if (!block || block.kind !== "paragraph") return false;
  return block.runs.some((r) => r.kind === "text" && r.properties.revision?.type === type);
}

describe("inline / range parity", () => {
  it("insertRun — text run mid-paragraph", () => {
    const p = peers(singleParaDoc());
    p.editor.insertRun({ block: p.editor.getBlock(0), offset: 2 }, text("XX"));
    p.headless.insertRun({ block: p.headless.getBlock(0), offset: 2 }, text("XX"));
    expectParity(p);
  });

  it("applyRunProperties — bold across a sub-range", () => {
    const p = peers(singleParaDoc());
    p.editor.applyRunProperties(mkRange(p.editor.getBlock(0), 0, 2), { bold: true });
    p.headless.applyRunProperties(mkRange(p.headless.getBlock(0), 0, 2), { bold: true });
    expectParity(p);
  });

  it("wrapRange — em across a sub-range", () => {
    const p = peers(singleParaDoc());
    p.editor.wrapRange(mkRange(p.editor.getBlock(0), 1, 4), "em");
    p.headless.wrapRange(mkRange(p.headless.getBlock(0), 1, 4), "em");
    expectParity(p);
  });

  it("deleteRange — within a single paragraph", () => {
    const p = peers(singleParaDoc());
    p.editor.deleteRange(mkRange(p.editor.getBlock(0), 1, 3));
    p.headless.deleteRange(mkRange(p.headless.getBlock(0), 1, 3));
    expectParity(p);
  });

  it("deleteRange — across two paragraphs merges into one", () => {
    const p = peers(threeParaDoc());
    p.editor.deleteRange({
      from: { block: p.editor.getBlock(0), offset: 1 },
      to: { block: p.editor.getBlock(2), offset: 2 },
    });
    p.headless.deleteRange({
      from: { block: p.headless.getBlock(0), offset: 1 },
      to: { block: p.headless.getBlock(2), offset: 2 },
    });
    expectParity(p);
    // "one" + "three" collapse to a single block: "o" + "ree".
    expect(p.editor.getDocument().body.length).toBe(1);
  });

  it("tracked insertRun stamps an ins revision identically", () => {
    const p = peers(singleParaDoc());
    p.editor.setTrackChanges({ enabled: true, author: "Ada" });
    p.headless.setTrackChanges({ enabled: true, author: "Ada" });
    p.editor.insertRun({ block: p.editor.getBlock(0), offset: 2 }, text("NEW"));
    p.headless.insertRun({ block: p.headless.getBlock(0), offset: 2 }, text("NEW"));
    expectParity(p);
    expect(firstBlockHasRevision(p.headless.getDocument(), "ins")).toBe(true);
  });

  it("tracked deleteRange stamps del revisions identically", () => {
    const p = peers(singleParaDoc());
    p.editor.setTrackChanges({ enabled: true, author: "Ada" });
    p.headless.setTrackChanges({ enabled: true, author: "Ada" });
    p.editor.deleteRange(mkRange(p.editor.getBlock(0), 0, 4));
    p.headless.deleteRange(mkRange(p.headless.getBlock(0), 0, 4));
    expectParity(p);
    expect(firstBlockHasRevision(p.headless.getDocument(), "del")).toBe(true);
  });
});

// === tracked-change review (consumption) + comments ===

describe("review + comment parity", () => {
  /** Span shape without the per-peer block id (ids live in the registry). */
  const normSpan = (s: RevisionSpan) => ({
    from: s.range.from.offset,
    to: s.range.to.offset,
    kinds: s.kinds,
    level: s.level,
    author: s.author,
  });

  function trackedInsert(p: Peers): void {
    p.editor.setTrackChanges({ enabled: true, author: "Ada" });
    p.headless.setTrackChanges({ enabled: true, author: "Ada" });
    p.editor.insertRun({ block: p.editor.getBlock(0), offset: 2 }, text("NEW"));
    p.headless.insertRun({ block: p.headless.getBlock(0), offset: 2 }, text("NEW"));
  }

  it("getRevisions enumerates a tracked insert identically", () => {
    const p = peers(singleParaDoc());
    trackedInsert(p);
    const e = p.editor.getRevisions().map(normSpan);
    const h = p.headless.getRevisions().map(normSpan);
    expect(e).toEqual(h);
    expect(e.length).toBeGreaterThan(0);
  });

  it("acceptRevision after a tracked insert — parity", () => {
    const p = peers(singleParaDoc());
    trackedInsert(p);
    const eSpan = p.editor.getRevisions()[0];
    const hSpan = p.headless.getRevisions()[0];
    expect(eSpan).toBeDefined();
    expect(hSpan).toBeDefined();
    p.editor.acceptRevision(eSpan!.range);
    p.headless.acceptRevision(hSpan!.range);
    expectParity(p);
    expect(p.headless.getRevisions().length).toBe(0);
  });

  it("rejectRevision after a tracked delete — parity", () => {
    const p = peers(singleParaDoc());
    p.editor.setTrackChanges({ enabled: true, author: "Ada" });
    p.headless.setTrackChanges({ enabled: true, author: "Ada" });
    p.editor.deleteRange(mkRange(p.editor.getBlock(0), 0, 4));
    p.headless.deleteRange(mkRange(p.headless.getBlock(0), 0, 4));
    p.editor.rejectRevision(p.editor.getRevisions()[0]!.range);
    p.headless.rejectRevision(p.headless.getRevisions()[0]!.range);
    expectParity(p);
    expect(p.headless.getRevisions().length).toBe(0);
  });

  it("resolveComment / reopenComment — parity", () => {
    const p = peers(commentDoc());
    expect(p.editor.resolveComment(1).ok).toBe(true);
    expect(p.headless.resolveComment(1).ok).toBe(true);
    expect(p.editor.getDocument().comments?.[1]?.done).toBe(true);
    expect(p.headless.getDocument().comments?.[1]?.done).toBe(true);

    expect(p.editor.reopenComment(1).ok).toBe(true);
    expect(p.headless.reopenComment(1).ok).toBe(true);
    expect(p.headless.getDocument().comments?.[1]?.done).toBe(false);

    // unknown id fails identically
    expect(p.editor.resolveComment(99).ok).toBe(false);
    expect(p.headless.resolveComment(99).ok).toBe(false);
  });
});
