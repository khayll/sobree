/**
 * Insert parsed clipboard content at the caret (model-first rich paste, Phase
 * 3-5). Splits out of `pasteHtml` so the parser stays a pure DOM→AST concern
 * and this owns the AST-mutation side (splice / split-and-merge, numbering
 * remap, tracked-`ins` stamping).
 */

import type { Range as ApiRange, InlinePosition } from "../../doc/api";
import { paragraphTargetAt } from "../../doc/mutations/paragraphTarget";
import { stampInsertRevision } from "../../doc/mutations/revisions";
import { mergeAdjacentTextRuns, splitRunsAt } from "../../doc/runs";
import type {
  Block,
  InlineRun,
  NumberingDefinition,
  Paragraph,
  ParagraphProperties,
} from "../../doc/types";
import type { EditorContext } from "../context";
import * as query from "../query";
import { insertBlockAfter, replaceBlock } from "./blocks";
import { parseClipboardHtml } from "./pasteHtml";
import { deleteRange } from "./runs";

/**
 * Parse `html` and insert it at the current selection through the typed API.
 * Returns `false` when nothing usable parsed (caller falls back to plain-text
 * paste). Tracked mode stamps inserted runs / paragraph marks `ins`. A single
 * plain paragraph SPLICES inline into the caret paragraph (keeping it one
 * block); anything with block structure splits the caret paragraph and merges
 * the first / last plain paragraphs into the two halves — matching how
 * Word/Google paste multi-paragraph content at a caret.
 */
export function pasteHtmlAtCaret(ctx: EditorContext, html: string): boolean {
  const parsed = parseClipboardHtml(html);
  if (parsed.blocks.length === 0) return false;
  ctx.ensureCurrent();

  // Remap the paste's list numIds clear of the document's, and register the
  // definitions so the pasted list renders with the right markers.
  const { blocks: remapped, addedNumbering } = remapNumbering(
    parsed.blocks,
    parsed.numbering,
    ctx.doc.numbering ?? [],
  );
  if (addedNumbering.length > 0) {
    ctx.commit({ numbering: [...(ctx.doc.numbering ?? []), ...addedNumbering] }, []);
  }
  return pasteBlocksAtCaret(ctx, remapped);
}

/**
 * Which endpoint blocks of a paste payload MERGE into the caret paragraph's
 * halves rather than standing as their own blocks. The HTML path (no flags
 * available) infers it from block shape via `isMergeable`; the structured
 * clipboard KNOWS — a sliced (partial) endpoint lost its paragraph mark and
 * merges, a complete one keeps its paragraph identity and splits the caret
 * block to stand alone. Word's paragraph-mark rule, made explicit.
 */
export interface MergePolicy {
  first: boolean;
  last: boolean;
}

/** A paragraph CAN merge (structurally); policy decides whether it SHOULD. */
function canMerge(block: Block): boolean {
  return block.kind === "paragraph";
}

/**
 * Insert ready-made AST `blocks` at the current selection with the paste
 * semantics above (inline splice for a merging single paragraph;
 * split-and-merge for block structure; cell carets paste into the cell).
 * Shared by the HTML paste (after parsing) and the structured-clipboard
 * FRAGMENT paste — one owner for "what pasting at a caret means". Unlike
 * the HTML path, no numbering remap happens here: a structured payload's
 * numIds come from this document and still resolve.
 */
export function pasteBlocksAtCaret(
  ctx: EditorContext,
  input: Block[],
  merge?: MergePolicy,
): boolean {
  if (input.length === 0) return false;
  ctx.ensureCurrent();
  const author = ctx.trackChanges.enabled ? ctx.trackChanges.author : undefined;
  const blocks = ctx.trackChanges.enabled ? input.map((b) => stampBlockRuns(b, author)) : input;
  const mergeFirst = canMerge(blocks[0]!) && (merge ? merge.first : isMergeable(blocks[0]!));
  const mergeLast =
    canMerge(blocks[blocks.length - 1]!) &&
    (merge ? merge.last : isMergeable(blocks[blocks.length - 1]!));

  const caret = collapseToCaret(ctx);
  if (!caret) return false;

  // Caret inside a table cell — paste into the CELL's own content. The block
  // ops below address `doc.body`, so routing a cell caret through them pasted
  // the content after the whole TABLE instead of into the cell.
  if (caret.cell) return pasteIntoCell(ctx, caret, blocks, mergeFirst, mergeLast);

  const targetIdx = ctx.registry.indexOf(caret.block.id);
  const target = ctx.doc.body[targetIdx];
  if (targetIdx < 0 || target?.kind !== "paragraph") {
    // Caret not in a paragraph at all (e.g. a section break): append the
    // blocks after it rather than splice.
    return insertBlocksAfter(ctx, ctx.registry.refAt(targetIdx), blocks);
  }

  const targetRef = ctx.registry.refAt(targetIdx);
  const { before, after } = splitRunsAt(target.runs, caret.offset);

  // Inline paste: one merging paragraph splices into the caret paragraph so
  // it stays a single block.
  if (blocks.length === 1 && (mergeFirst || mergeLast)) {
    const inserted = (blocks[0] as Paragraph).runs;
    const runs = mergeAdjacentTextRuns([...before, ...inserted, ...after]);
    const res = replaceBlock(ctx, targetRef, { ...target, runs });
    if (res.ok) query.placeCaret(ctx, targetRef.id, caret.offset + runsLength(inserted));
    return true;
  }

  // Block paste: merging first / last paragraphs join the split halves; the
  // remaining blocks insert between as themselves.
  let list = blocks;
  let headRuns = before;
  let mergedHead = false;
  if (list.length > 0 && mergeFirst) {
    headRuns = mergeAdjacentTextRuns([...before, ...(list[0] as Paragraph).runs]);
    list = list.slice(1);
    mergedHead = true;
  }
  let tailRuns = after;
  let mergedTail = false;
  // Where the pasted content ENDS inside the tail block — the caret's landing.
  // A merged trailing fragment occupies the tail's head, so "after the paste"
  // is after those runs; a pure remainder tail starts at the paste boundary.
  let tailCaretOffset = 0;
  if (list.length > 0 && mergeLast) {
    const fragment = (list[list.length - 1] as Paragraph).runs;
    tailRuns = mergeAdjacentTextRuns([...fragment, ...after]);
    list = list.slice(0, -1);
    mergedTail = true;
    tailCaretOffset = runsLength(fragment);
  }

  // Caret at the very START of the block, first pasted block standing alone:
  // don't leave an empty paragraph above it. The first pasted block takes the
  // target's slot instead (the target's own content is entirely in `after`,
  // so nothing — including tracked `del` runs — is lost; it re-emerges in the
  // tail below).
  if (!mergedHead && before.length === 0 && list.length > 0) {
    replaceBlock(ctx, targetRef, list[0]!);
    list = list.slice(1);
  } else {
    replaceBlock(ctx, targetRef, { ...target, runs: headRuns });
  }
  // `replaceBlock` bumped the block's version — refetch a fresh ref by (stable)
  // id, or the next insert's optimistic-lock check fails on the stale version.
  let afterRef = ctx.registry.refById(targetRef.id) ?? targetRef;
  for (const block of list) {
    const res = insertBlockAfter(ctx, afterRef, block);
    const ref = res.ok ? res.affected[0] : undefined;
    if (!ref) return true;
    afterRef = ref;
  }

  // A tail paragraph carries the ORIGINAL paragraph's block properties (the
  // remainder keeps its style). Emit it when there was content after the caret
  // or a trailing paragraph merged into it.
  if (mergedTail || after.length > 0) {
    const tail: Paragraph = {
      kind: "paragraph",
      properties: { ...target.properties },
      runs: tailRuns,
    };
    const res = insertBlockAfter(ctx, afterRef, tail);
    const ref = res.ok ? res.affected[0] : undefined;
    // AFTER the pasted content — past a merged fragment, not before it.
    // Landing at the tail's start put the caret BEFORE the fragment, so a
    // repeat paste inserted ahead of the previous one: standalone blocks
    // stacked up while the fragments glued together behind the caret.
    if (ref) query.placeCaret(ctx, ref.id, tailCaretOffset);
  } else {
    query.placeCaret(ctx, afterRef.id, blockEndOffset(ctx, afterRef.id));
  }
  return true;
}

/**
 * Paste `blocks` at a caret inside a table cell, mirroring the body semantics:
 * one plain paragraph splices INLINE into the cell's paragraph (it stays one
 * block); block structure splits that paragraph and merges the first / last
 * plain paragraphs into the halves, with the rest landing between — all within
 * the cell's own `content`.
 *
 * Writes through `withParagraph` / `withBlocks` and bumps the TABLE, since cell
 * content isn't registry-tracked. `false` when the cell isn't addressable (see
 * `paragraphTargetAt`), leaving the caller its plain-text fallback rather than
 * dropping the content somewhere else in the document.
 */
function pasteIntoCell(
  ctx: EditorContext,
  caret: InlinePosition,
  blocks: Block[],
  mergeFirst: boolean,
  mergeLast: boolean,
): boolean {
  const target = paragraphTargetAt(ctx.doc, ctx.registry, caret);
  if (!target) return false;
  const { before, after } = splitRunsAt(target.paragraph.runs, caret.offset);

  if (blocks.length === 1 && (mergeFirst || mergeLast)) {
    const inserted = (blocks[0] as Paragraph).runs;
    const runs = mergeAdjacentTextRuns([...before, ...inserted, ...after]);
    const body = target.withParagraph({ ...target.paragraph, runs });
    if (!ctx.commit({ body }, [{ type: "bump", index: target.index }]).ok) return true;
    query.placeCaretAt(ctx, { ...caret, offset: caret.offset + runsLength(inserted) });
    return true;
  }

  // Block paste: merging first / last paragraphs join the split halves.
  let list = blocks;
  let headRuns = before;
  let mergedHead = false;
  if (list.length > 0 && mergeFirst) {
    headRuns = mergeAdjacentTextRuns([...before, ...(list[0] as Paragraph).runs]);
    list = list.slice(1);
    mergedHead = true;
  }
  let tailRuns = after;
  let mergedTail = false;
  // Caret landing inside the tail: after a merged fragment, else at the
  // paste boundary (tail start) — same rule as the body path.
  let tailCaretOffset = 0;
  if (list.length > 0 && mergeLast) {
    const fragment = (list[list.length - 1] as Paragraph).runs;
    tailRuns = mergeAdjacentTextRuns([...fragment, ...after]);
    list = list.slice(0, -1);
    mergedTail = true;
    tailCaretOffset = runsLength(fragment);
  }

  const head: Paragraph = { ...target.paragraph, runs: headRuns };
  // Same empty-head elision as the body path: caret at the block start with a
  // standalone first pasted block leaves no empty paragraph above it.
  const emitted: Block[] =
    !mergedHead && before.length === 0 && list.length > 0 ? [...list] : [head, ...list];
  // The tail keeps the original paragraph's properties (the remainder keeps its
  // style) — emitted only when content followed the caret or a paragraph merged
  // into it, matching the body path.
  const hasTail = mergedTail || after.length > 0;
  if (hasTail) {
    emitted.push({
      kind: "paragraph",
      properties: { ...target.paragraph.properties },
      runs: tailRuns,
    });
  }

  const body = target.withBlocks(emitted);
  if (!body) return false;
  if (!ctx.commit({ body }, [{ type: "bump", index: target.index }]).ok) return true;

  // Caret AFTER the pasted content, in cell coordinates: past a merged
  // fragment in the tail, at the tail's start for a pure remainder, else at
  // the end of the last block pasted — the body path's rule.
  const cell = caret.cell;
  if (!cell) return true;
  const last = emitted[emitted.length - 1];
  query.placeCaretAt(ctx, {
    block: caret.block,
    offset: hasTail ? tailCaretOffset : last?.kind === "paragraph" ? runsLength(last.runs) : 0,
    cell: { ...cell, blockIndex: cell.blockIndex + emitted.length - 1 },
  });
  return true;
}

/** Collapse the current selection to a caret, deleting a selected range first.
 *  Returns the resulting caret position, or `null`. */
function collapseToCaret(ctx: EditorContext): InlinePosition | null {
  const sel = ctx.selection.get();
  if (!sel) return null;
  if (sel.kind === "caret") return query.refreshedPosition(ctx, sel.at);
  const range: ApiRange = sel.range;
  const del = deleteRange(ctx, range);
  if (!del.ok) return null;
  return query.refreshedPosition(ctx, range.from);
}

/** Fallback: insert `blocks` after `afterRef` in order (no splice). */
function insertBlocksAfter(
  ctx: EditorContext,
  afterRef: ReturnType<EditorContext["registry"]["refAt"]>,
  blocks: readonly Block[],
): boolean {
  let ref = afterRef;
  for (const block of blocks) {
    const res = insertBlockAfter(ctx, ref, block);
    const inserted = res.ok ? res.affected[0] : undefined;
    if (!inserted) return true;
    ref = inserted;
  }
  query.placeCaret(ctx, ref.id, 0);
  return true;
}

/** A plain paragraph whose runs may merge into another paragraph — no heading
 *  style, no list membership. */
function isMergeable(block: Block): boolean {
  return block.kind === "paragraph" && !block.properties.styleId && !block.properties.numbering;
}

/** Offset length of a run list (text length; every non-text inline is 1). */
function runsLength(runs: readonly InlineRun[]): number {
  return runs.reduce((n, r) => n + (r.kind === "text" ? r.text.length : 1), 0);
}

/** Content offset at the end of a block, for caret placement. */
function blockEndOffset(ctx: EditorContext, blockId: string): number {
  const info = query.getBlockById(ctx, blockId);
  return info ? info.length : 0;
}

/** Stamp a block's text runs (and hyperlink children) with an `ins` revision —
 *  the tracked-paste marker for pasted content. */
function stampBlockRuns(block: Block, author: string | undefined): Block {
  if (block.kind !== "paragraph") return block;
  return { ...block, runs: block.runs.map((r) => stampRun(r, author)) };
}

function stampRun(run: InlineRun, author: string | undefined): InlineRun {
  if (run.kind === "hyperlink") {
    return { ...run, children: run.children.map((c) => stampRun(c, author)) };
  }
  return stampInsertRevision(run, author);
}

/**
 * Remap the paste's list numIds (local, starting at 1) above the document's
 * highest, returning the rewritten blocks and the numbering definitions to
 * register. A no-op when the paste has no lists.
 */
function remapNumbering(
  blocks: Block[],
  pastedNumbering: readonly NumberingDefinition[],
  docNumbering: readonly NumberingDefinition[],
): { blocks: Block[]; addedNumbering: NumberingDefinition[] } {
  if (pastedNumbering.length === 0) return { blocks, addedNumbering: [] };
  const base = docNumbering.reduce((max, n) => Math.max(max, n.numId), 0);
  const idMap = new Map<number, number>();
  const added = pastedNumbering.map((def) => {
    const numId = base + def.numId;
    idMap.set(def.numId, numId);
    return { ...def, numId };
  });
  return { blocks: blocks.map((b) => remapBlockNumbering(b, idMap)), addedNumbering: added };
}

function remapBlockNumbering(block: Block, idMap: Map<number, number>): Block {
  if (block.kind !== "paragraph" || !block.properties.numbering) return block;
  const mapped = idMap.get(block.properties.numbering.numId);
  if (mapped === undefined) return block;
  const properties: ParagraphProperties = {
    ...block.properties,
    numbering: { ...block.properties.numbering, numId: mapped },
  };
  return { ...block, properties };
}
