/**
 * Structured clipboard: copy exactly what the selection covers as JSON,
 * and paste it back with full fidelity.
 *
 * Without this, copy/paste rides the browser's contentEditable default:
 * the clipboard carries only text/HTML, and a pasted styled paragraph or
 * table comes back as plain runs in the current block (a lossy DOM
 * readback). Here a structured payload (`BLOCKS_MIME`) carries the exact
 * AST. A `text/plain` fallback is always written too, so pasting into
 * another app still yields the text.
 *
 * The payload mirrors Word's paragraph-mark distinction:
 *   - a selection that covers its endpoint blocks END-TO-END copies WHOLE
 *     blocks; pasting inserts them as new blocks after the caret's block
 *     ("copy a block, paste it below, get two similar blocks");
 *   - a selection that ends PARTWAY through a block copies a FRAGMENT:
 *     the sliced endpoint paragraphs lose their paragraph mark and MERGE
 *     into the caret paragraph's halves on paste, while a COMPLETE
 *     endpoint (e.g. a fully-selected heading followed by a partial
 *     paragraph) keeps its paragraph identity and stands as its own
 *     block, splitting the caret paragraph when needed. Copying the
 *     whole blocks here pasted back text the user never selected.
 *
 * A range inside ONE block copies structurally only when it covers the
 * block end-to-end — a partial in-block selection stays on the browser's
 * default copy, whose HTML the rich-paste path already handles. A
 * collapsed caret copies nothing structured.
 */

import type { InlinePosition } from "../../doc/api";
import { sliceRuns } from "../../doc/runs";
import type { Block, InlineRun } from "../../doc/types";
import type { EditorContext } from "../context";
import * as query from "../query";
import { deleteBlock, insertBlockAfter } from "./blocks";
import { pasteBlocksAtCaret } from "./pasteInsert";
import { deleteRange } from "./runs";

/** Clipboard MIME for a Sobree block payload. The `+json` suffix and the
 *  `web ` prefix browsers add for custom types both round-trip our reader. */
export const BLOCKS_MIME = "application/x-sobree-blocks+json";

interface BlocksPayload {
  v: 1;
  blocks: Block[];
  /** Present when the copy didn't cover its endpoint blocks end-to-end.
   *  `first` / `last` say WHICH endpoint was sliced to the selection — a
   *  sliced endpoint lost its paragraph mark, so pasting merges it into the
   *  caret paragraph's halves; a complete endpoint keeps its paragraph
   *  identity and stands as its own block (splitting the caret paragraph
   *  when needed). Absent (older payloads) means whole blocks. */
  fragment?: { first: boolean; last: boolean };
}

export type FragmentEnds = { first: boolean; last: boolean };

/** Serialise blocks for the clipboard. */
export function serializeBlocks(
  blocks: readonly Block[],
  opts?: { fragment?: FragmentEnds },
): string {
  const payload: BlocksPayload = { v: 1, blocks: blocks as Block[] };
  if (opts?.fragment) payload.fragment = opts.fragment;
  return JSON.stringify(payload);
}

/** Parse a clipboard payload, or `null` when the data isn't ours / is
 *  malformed (caller then falls back to the text/HTML paste path). */
export function parseBlocks(
  data: string | undefined | null,
): { blocks: Block[]; fragment: FragmentEnds | null } | null {
  if (!data) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const blocks = (parsed as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  if (!blocks.every((b) => typeof b === "object" && b !== null && typeof b.kind === "string")) {
    return null;
  }
  const rawFragment = (parsed as BlocksPayload).fragment;
  const fragment =
    typeof rawFragment === "object" &&
    rawFragment !== null &&
    typeof rawFragment.first === "boolean" &&
    typeof rawFragment.last === "boolean"
      ? { first: rawFragment.first, last: rawFragment.last }
      : null;
  return { blocks: blocks as Block[], fragment };
}

/** Plain-text projection of a block (the `text/plain` clipboard fallback). */
function blockText(block: Block): string {
  if (block.kind === "paragraph") {
    return block.runs.map(runText).join("");
  }
  if (block.kind === "table") {
    return block.rows
      .map((r) => r.cells.map((c) => c.content.map(blockText).join(" ")).join("\t"))
      .join("\n");
  }
  return "";
}

function runText(run: InlineRun): string {
  if (run.kind === "text") return run.text;
  if (run.kind === "hyperlink") return run.children.map(runText).join("");
  return "";
}

/** Offset length of a paragraph's content (text chars; every non-text
 *  inline counts as 1, matching `InlinePosition` offset semantics). `-1`
 *  for non-paragraph blocks, whose end-coverage we can't read from a flat
 *  offset — those copy only via a multi-block selection. */
function paragraphLength(block: Block): number {
  if (block.kind !== "paragraph") return -1;
  return block.runs.reduce((n, r) => n + (r.kind === "text" ? r.text.length : 1), 0);
}

/** What the selection covers, in document order. `full` = both endpoint
 *  blocks are covered end-to-end (⇒ whole-block copy semantics). */
interface SelectionCoverage {
  lo: number;
  hi: number;
  /** Document-order endpoints (a backwards selection is normalised). */
  from: InlinePosition;
  to: InlinePosition;
  /** Per-endpoint end-to-end coverage; `full` = both. */
  firstFull: boolean;
  lastFull: boolean;
  full: boolean;
}

/**
 * Resolve the selection to covered block indices + normalised endpoints,
 * or `null` when there's nothing structurally copyable: a caret, or a
 * PARTIAL selection inside one block (that stays on the browser's default
 * copy — its HTML fragment already carries the selected slice).
 */
function selectionCoverage(ctx: EditorContext): SelectionCoverage | null {
  const sel = ctx.selection.get();
  if (!sel || sel.kind !== "range") return null;
  const fromIdx = ctx.registry.indexOf(sel.range.from.block.id);
  const toIdx = ctx.registry.indexOf(sel.range.to.block.id);
  if (fromIdx < 0 || toIdx < 0) return null;
  // Normalise to document order — selections made bottom-up arrive reversed.
  const backwards =
    fromIdx > toIdx || (fromIdx === toIdx && sel.range.from.offset > sel.range.to.offset);
  const [lo, hi] = backwards ? [toIdx, fromIdx] : [fromIdx, toIdx];
  const from = backwards ? sel.range.to : sel.range.from;
  const to = backwards ? sel.range.from : sel.range.to;

  // End-to-end coverage of an endpoint. Non-paragraph endpoints (tables —
  // their flat offsets don't map to slices) always count as fully covered,
  // preserving the whole-block behaviour for them.
  const first = ctx.doc.body[lo];
  const last = ctx.doc.body[hi];
  if (!first || !last) return null;
  const firstLen = paragraphLength(first);
  const lastLen = paragraphLength(last);
  const firstFull = firstLen < 0 || from.offset === 0;
  const lastFull = lastLen < 0 || to.offset >= lastLen;

  // One block, partially covered → not structurally copyable.
  if (lo === hi && !(firstFull && lastFull)) return null;
  return { lo, hi, from, to, firstFull, lastFull, full: firstFull && lastFull };
}

/**
 * EXACTLY the content the selection covers, cloned: whole blocks when the
 * endpoints are covered end-to-end, otherwise the endpoint paragraphs are
 * SLICED to the selected offsets (`fragment: true`). Copying whole blocks
 * for a partial selection pasted back text the user never selected.
 */
export function selectedBlocks(
  ctx: EditorContext,
): { blocks: Block[]; fragment: FragmentEnds | null } | null {
  const cov = selectionCoverage(ctx);
  if (!cov) return null;
  const blocks = ctx.doc.body.slice(cov.lo, cov.hi + 1).map(cloneBlock);
  if (!cov.full) {
    const first = blocks[0];
    if (!cov.firstFull && first?.kind === "paragraph") {
      first.runs = sliceRuns(first.runs, cov.from.offset, paragraphLength(first));
    }
    const last = blocks[blocks.length - 1];
    if (!cov.lastFull && last?.kind === "paragraph" && blocks.length > 1) {
      last.runs = sliceRuns(last.runs, 0, cov.to.offset);
    }
  }
  return { blocks, fragment: cov.full ? null : { first: !cov.firstFull, last: !cov.lastFull } };
}

/** Write blocks to the clipboard (structured payload + text fallback). */
function writeBlocks(
  e: ClipboardEvent,
  blocks: readonly Block[],
  fragment: FragmentEnds | null,
): void {
  if (!e.clipboardData) return;
  e.preventDefault();
  e.clipboardData.setData(BLOCKS_MIME, serializeBlocks(blocks, fragment ? { fragment } : {}));
  e.clipboardData.setData("text/plain", blocks.map(blockText).join("\n"));
}

/** `copy` handler: write exactly the covered content, or let the browser
 *  run its default copy when nothing is structurally covered. */
export function onCopy(ctx: EditorContext, e: ClipboardEvent): void {
  const selected = selectedBlocks(ctx);
  if (selected) writeBlocks(e, selected.blocks, selected.fragment);
}

/**
 * `cut` handler: copy exactly the covered content AND remove it. Fully
 * covered blocks are removed whole (`deleteBlock` — marks them in tracked
 * mode); a partial cross-block selection deletes only the selected RANGE
 * (`deleteRange` merges the endpoint paragraphs, as Backspace over the same
 * selection would) — it used to delete the WHOLE endpoint blocks, taking
 * text the user never selected with it. A partial in-block selection falls
 * through to the browser's default cut (the model catches it at
 * `beforeinput` as `deleteByCut`).
 */
export function onCut(ctx: EditorContext, e: ClipboardEvent): void {
  const cov = selectionCoverage(ctx);
  const selected = selectedBlocks(ctx);
  if (!cov || !selected || !e.clipboardData) return;
  writeBlocks(e, selected.blocks, selected.fragment);

  if (!cov.full) {
    if (deleteRange(ctx, { from: cov.from, to: cov.to }).ok) {
      query.placeCaretAt(ctx, cov.from);
    }
    return;
  }

  // Capture refs up front — deleting shifts indices, but ref ids are stable.
  const refs: ReturnType<EditorContext["registry"]["refAt"]>[] = [];
  for (let i = cov.lo; i <= cov.hi; i++) refs.push(ctx.registry.refAt(i));
  for (const ref of refs) {
    if (!deleteBlock(ctx, ref).ok) break;
  }
  // Caret to the block now at the cut site (or the last surviving block).
  const idx = Math.min(cov.lo, ctx.doc.body.length - 1);
  if (idx >= 0) {
    ctx.selection.set({ kind: "caret", at: { block: ctx.registry.refAt(idx), offset: 0 } });
  }
}

/**
 * Paste handler hook for a structured block payload. Returns `true` when it
 * consumed the event (block paste), `false` to let the normal text/image
 * paste run. A whole-block payload inserts new blocks after the caret's
 * block; a FRAGMENT payload splices at the caret through the same machinery
 * as rich HTML paste (first/last plain paragraphs merge into the caret
 * paragraph's halves) — mirroring Word's paragraph-mark distinction.
 */
export function tryPasteBlocks(ctx: EditorContext, e: ClipboardEvent): boolean {
  const payload = parseBlocks(e.clipboardData?.getData(BLOCKS_MIME));
  if (!payload) return false;
  e.preventDefault();
  if (payload.fragment) {
    // A SLICED endpoint lost its paragraph mark → merge; a complete one
    // stands as its own block (splitting the caret paragraph when needed).
    pasteBlocksAtCaret(ctx, payload.blocks.map(cloneBlock), payload.fragment);
  } else {
    pasteBlocksAfterCaret(ctx, payload.blocks);
  }
  return true;
}

/** Insert `blocks` (deep-cloned, fresh ids) after the caret's block. */
export function pasteBlocksAfterCaret(ctx: EditorContext, blocks: readonly Block[]): void {
  ctx.ensureCurrent();
  const targetId = caretBlockId(ctx);
  if (!targetId) return;
  let afterRef = ctx.registry.refById(targetId);
  if (!afterRef) return;
  for (const block of blocks) {
    const res = insertBlockAfter(ctx, afterRef, cloneBlock(block));
    // The inserted block's ref comes back in `affected` (an insert yields
    // no `value`); chain the next insert after it.
    const inserted = res.ok ? res.affected[0] : undefined;
    if (!inserted) return;
    afterRef = inserted;
  }
  // Caret to the start of the last block pasted.
  ctx.selection.set({ kind: "caret", at: { block: afterRef, offset: 0 } });
}

/** The block id the caret / selection end sits in. */
function caretBlockId(ctx: EditorContext): string | null {
  const sel = ctx.selection.get();
  if (sel?.kind === "caret") return sel.at.block.id;
  if (sel?.kind === "range") return sel.range.to.block.id;
  const body = ctx.doc.body;
  return body.length > 0 ? ctx.registry.refAt(body.length - 1).id : null;
}

/** JSON-clean deep clone — strips any shared references so a pasted block
 *  never aliases the source (and carries no stale id). */
function cloneBlock(block: Block): Block {
  return JSON.parse(JSON.stringify(block)) as Block;
}
