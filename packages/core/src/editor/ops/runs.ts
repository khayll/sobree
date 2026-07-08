import {
  type Range as ApiRange,
  type BlockRef,
  type EditResult,
  type InlinePosition,
  fail,
} from "../../doc/api";
import {
  applyRunPropertiesMutation,
  deleteRangeMutation,
  insertRunMutation,
  mutateRunsInRangeMutation,
} from "../../doc/mutations";
import { type RunPropertiesPatch, mergeAdjacentTextRuns, splitRunsAt } from "../../doc/runs";
import type { DrawingRun, InlineRun, Paragraph, ParagraphProperties } from "../../doc/types";
import type { EditorContext } from "../context";
import {
  caretRangeFromPoint,
  closestBlockElement,
  currentDomRangeInsideHosts,
  hasImageInDataTransfer,
  readImageDimensions,
  unwrap,
} from "../dom";
import { applyMutation, mutationInput } from "../internal/applyMutation";
import { allocateMediaPath, mimeToExtension, pxToEmu, wrapTagToPatch } from "../internal/mutations";
import type { WrapTag } from "../types";
import * as parts from "./parts";

/**
 * Browser adapters for the inline (run-level) mutations — run properties,
 * wrapping, run/image insertion, paragraph split, and range deletion —
 * plus the image clipboard/drag handlers. The pure document transforms
 * live in the shared `doc/mutations` run engine; these wrappers sync the
 * DOM (`ensureCurrent`), pass the live doc/registry as the engine input,
 * hand it the editor's track-changes state, and apply the returned patch
 * through `ctx.commit`. `mutateRunsInRange` stays exported because the
 * review (accept/reject) module reuses the engine's range transform.
 */

/** Apply run-level properties across `range`. */
export function applyRunProperties(
  ctx: EditorContext,
  range: ApiRange,
  patch: RunPropertiesPatch,
  opts: { expect?: Record<string, number> } = {},
): EditResult<void> {
  ctx.ensureCurrent();
  return applyMutation(
    ctx,
    applyRunPropertiesMutation(mutationInput(ctx), range, patch, ctx.trackChanges, opts.expect),
  );
}

/** Wrap the runs in `range` with semantic formatting. */
export function wrapRange(
  ctx: EditorContext,
  range: ApiRange,
  tag: WrapTag,
  opts: { expect?: Record<string, number> } = {},
): EditResult<void> {
  return applyRunProperties(ctx, range, wrapTagToPatch(tag), opts);
}

/**
 * Insert a run at `at`. In track-changes mode the run is stamped
 * `revision: ins` (unless it already carries one — caller-provided
 * revisions win).
 */
export function insertRun(
  ctx: EditorContext,
  at: InlinePosition,
  run: InlineRun,
): EditResult<BlockRef> {
  ctx.ensureCurrent();
  return applyMutation(ctx, insertRunMutation(mutationInput(ctx), at, run, ctx.trackChanges));
}

/**
 * Split a paragraph at `at`. Runs before the offset stay; runs after
 * move into a fresh paragraph inserted immediately after, inheriting the
 * original's properties. In track-changes mode the new paragraph's
 * `properties.revision` is stamped `ins` (the "this break is a tracked
 * insert" marker). Returns the ref of the *new* (second) block.
 */
export function splitBlock(ctx: EditorContext, at: InlinePosition): EditResult<BlockRef> {
  ctx.ensureCurrent();
  const lockCheck = ctx.checkRefs([at.block]);
  if (lockCheck) return lockCheck;
  const index = ctx.registry.indexOf(at.block.id);
  const block = ctx.doc.body[index];
  if (!block || block.kind !== "paragraph") {
    return fail({ code: "invalid-position", details: "target is not a paragraph" });
  }
  const { before, after } = splitRunsAt(block.runs, at.offset);
  const firstHalf: Paragraph = { ...block, runs: mergeAdjacentTextRuns(before) };
  const newProps: ParagraphProperties = ctx.trackChanges.enabled
    ? {
        ...block.properties,
        revision:
          ctx.trackChanges.author === undefined
            ? { type: "ins" }
            : { type: "ins", author: ctx.trackChanges.author },
      }
    : { ...block.properties };
  const secondHalf: Paragraph = {
    kind: "paragraph",
    properties: newProps,
    runs: mergeAdjacentTextRuns(after),
  };
  const next = ctx.doc.body.slice();
  next.splice(index, 1, firstHalf, secondHalf);
  const result = ctx.commit({ body: next }, [
    { type: "bump", index },
    { type: "insert", index: index + 1 },
  ]);
  if (!result.ok) return result;
  // `affected` is `[bumped first half, inserted second half]`; surface
  // the new block's ref so callers skip a follow-up getBlock round-trip.
  const newRef = result.affected[1] ?? result.affected[0]!;
  return { ok: true, value: newRef, affected: result.affected };
}

/**
 * Insert an image at `at`. Bytes go into `doc.rawParts` under a fresh
 * `word/media/imageN.{ext}` path; a `DrawingRun` referencing it is
 * inserted. When a `blobStore` is configured the bytes migrate in the
 * background (hashed + uploaded + `partRefs` entry); the local renderer
 * keeps reading the inline bytes throughout.
 */
export function insertImage(
  ctx: EditorContext,
  at: InlinePosition,
  bytes: Uint8Array,
  opts: { mime: string; widthPx?: number; heightPx?: number; altText?: string },
): EditResult<BlockRef> {
  ctx.ensureCurrent();
  const ext = mimeToExtension(opts.mime);
  const partPath = allocateMediaPath(ctx.doc, ext);
  ctx.doc.rawParts[partPath] = bytes;
  // Mark for migration BEFORE the insertRun→commit→mirror chain so the
  // mirror's skip-set catches this path and doesn't write inline bytes.
  if (ctx.blobStore && ctx.blobCache) {
    ctx.pendingPartRefMigrations.add(partPath);
    void parts.migratePartToBlobStore(ctx, partPath, bytes);
  }
  const widthPx = opts.widthPx ?? 200;
  const heightPx = opts.heightPx ?? 150;
  const drawing: DrawingRun = {
    kind: "drawing",
    partPath,
    widthEmu: pxToEmu(widthPx),
    heightEmu: pxToEmu(heightPx),
    placement: "inline",
  };
  if (opts.altText) drawing.altText = opts.altText;
  return insertRun(ctx, at, drawing);
}

/**
 * Delete the content inside `range` (single- or cross-block). In
 * track-changes mode the deletion is *recorded*: plain runs are stamped
 * `del`, a run already marked as the same author's pending `ins` is
 * dropped (cancelling an un-committed insert), peer revisions are left
 * for accept/reject. Cross-paragraph tracked deletes also stamp each
 * later paragraph-mark `del` so `acceptAllRevisions` collapses the range.
 */
export function deleteRange(
  ctx: EditorContext,
  range: ApiRange,
  opts: { expect?: Record<string, number> } = {},
): EditResult<void> {
  ctx.ensureCurrent();
  return applyMutation(
    ctx,
    deleteRangeMutation(mutationInput(ctx), range, ctx.trackChanges, opts.expect),
  );
}

/**
 * Apply a runs transform to the runs covered by `range` and commit.
 * Assumes locks have already been checked. Adapter over the pure
 * `mutateRunsInRangeMutation`; exported for reuse by the review
 * (accept/reject) module.
 */
export function mutateRunsInRange(
  ctx: EditorContext,
  range: ApiRange,
  transform: (runs: InlineRun[]) => InlineRun[],
): EditResult<void> {
  return applyMutation(ctx, mutateRunsInRangeMutation(mutationInput(ctx), range, transform));
}

/**
 * Unwrap span ancestors intersecting the selection, up to the block.
 * Best-effort DOM-level cleanup — preserves the in-place UX without a
 * re-render.
 */
export function clearInlineFormattingAtSelection(ctx: EditorContext): void {
  const range = currentDomRangeInsideHosts(ctx.getContentHosts());
  if (!range) return;
  const block = closestBlockElement(range.startContainer, ctx.getContentHosts());
  if (!block) return;
  const spans: HTMLSpanElement[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) =>
      n instanceof HTMLSpanElement && range.intersectsNode(n)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) spans.push(n as HTMLSpanElement);
  for (const span of spans) unwrap(span);
  ctx.scheduleChange();
}

/** Insert an image at the current caret. */
export function insertImageAtSelection(
  ctx: EditorContext,
  bytes: Uint8Array,
  opts: { mime: string; widthPx?: number; heightPx?: number; altText?: string },
): EditResult<BlockRef> {
  const pos = ctx.selection.currentCaret();
  if (!pos) return fail({ code: "invalid-position", details: "no selection" });
  return insertImage(ctx, pos, bytes, opts);
}

/** Read a File's bytes + intrinsic dimensions and insert it at the caret. */
export async function insertImageFromFile(ctx: EditorContext, file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dims = await readImageDimensions(file);
  insertImageAtSelection(ctx, bytes, {
    mime: file.type || "image/png",
    widthPx: dims.width,
    heightPx: dims.height,
    altText: file.name,
  });
}

export function onDragOver(_ctx: EditorContext, e: DragEvent): void {
  if (!hasImageInDataTransfer(e.dataTransfer)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
}

export async function onDrop(ctx: EditorContext, e: DragEvent): Promise<void> {
  if (!hasImageInDataTransfer(e.dataTransfer)) return;
  e.preventDefault();
  const dropRange = caretRangeFromPoint(e.clientX, e.clientY);
  if (dropRange) {
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(dropRange);
    }
  }
  const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
  for (const file of files) await insertImageFromFile(ctx, file);
}
