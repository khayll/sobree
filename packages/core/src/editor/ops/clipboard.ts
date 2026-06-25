/**
 * Whole-block clipboard: copy the block(s) a selection covers as
 * structured JSON, and paste them back as real blocks below the caret.
 *
 * Without this, copy/paste rides the browser's contentEditable default:
 * the clipboard carries only text/HTML, and a pasted styled paragraph or
 * table comes back as plain runs in the current block (a lossy DOM
 * readback) — so "copy a block, paste it below, get two similar blocks"
 * silently degrades. Here a structured payload (`BLOCKS_MIME`) carries the
 * exact AST; paste deserialises it and inserts fresh blocks via
 * `insertBlockAfter`, which mints new ids and stamps track-changes marks.
 * A `text/plain` fallback is always written too, so pasting into another
 * app still yields the text.
 *
 * Trigger (copy): a range that spans MORE THAN ONE block copies those
 * whole blocks; a range INSIDE one block copies it only when it covers the
 * block end-to-end (a partial text selection stays a plain-text copy, as
 * users expect). A collapsed caret copies nothing structured.
 */

import type { Block, InlineRun } from "../../doc/types";
import type { EditorContext } from "../context";
import { insertBlockAfter } from "./blocks";

/** Clipboard MIME for a Sobree block payload. The `+json` suffix and the
 *  `web ` prefix browsers add for custom types both round-trip our reader. */
export const BLOCKS_MIME = "application/x-sobree-blocks+json";

interface BlocksPayload {
  v: 1;
  blocks: Block[];
}

/** Serialise blocks for the clipboard. */
export function serializeBlocks(blocks: readonly Block[]): string {
  const payload: BlocksPayload = { v: 1, blocks: blocks as Block[] };
  return JSON.stringify(payload);
}

/** Parse a clipboard payload back to blocks, or `null` when the data isn't
 *  ours / is malformed (caller then falls back to plain-text paste). */
export function parseBlocks(data: string | undefined | null): Block[] | null {
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
  return blocks as Block[];
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

/**
 * The whole blocks a selection covers, or `null` when the selection isn't
 * block-level (a caret, or a partial selection inside one block).
 */
export function selectedWholeBlocks(ctx: EditorContext): Block[] | null {
  const sel = ctx.selection.get();
  if (!sel || sel.kind !== "range") return null;
  const fromIdx = ctx.registry.indexOf(sel.range.from.block.id);
  const toIdx = ctx.registry.indexOf(sel.range.to.block.id);
  if (fromIdx < 0 || toIdx < 0) return null;
  const lo = Math.min(fromIdx, toIdx);
  const hi = Math.max(fromIdx, toIdx);
  const body = ctx.doc.body;

  // Spanning several blocks → take them whole.
  if (lo !== hi) return body.slice(lo, hi + 1).map(cloneBlock);

  // One block → only when the range covers it end-to-end.
  const block = body[lo];
  if (!block) return null;
  const len = paragraphLength(block);
  const a = Math.min(sel.range.from.offset, sel.range.to.offset);
  const b = Math.max(sel.range.from.offset, sel.range.to.offset);
  if (len >= 0 && a === 0 && b >= len) return [cloneBlock(block)];
  return null;
}

/** `copy` handler: write the covered whole blocks (structured + text), or
 *  let the browser run its default plain-text copy when none are covered. */
export function onCopy(ctx: EditorContext, e: ClipboardEvent): void {
  const blocks = selectedWholeBlocks(ctx);
  if (!blocks || !e.clipboardData) return;
  e.preventDefault();
  e.clipboardData.setData(BLOCKS_MIME, serializeBlocks(blocks));
  e.clipboardData.setData("text/plain", blocks.map(blockText).join("\n"));
}

/**
 * Paste handler hook for a structured block payload. Returns `true` when it
 * consumed the event (block paste), `false` to let the normal text/image
 * paste run. Inserts the pasted blocks after the caret's block, in order.
 */
export function tryPasteBlocks(ctx: EditorContext, e: ClipboardEvent): boolean {
  const blocks = parseBlocks(e.clipboardData?.getData(BLOCKS_MIME));
  if (!blocks) return false;
  e.preventDefault();
  pasteBlocksAfterCaret(ctx, blocks);
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
