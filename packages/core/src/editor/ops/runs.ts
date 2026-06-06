import {
  type Range as ApiRange,
  type BlockRef,
  type EditResult,
  type InlinePosition,
  fail,
} from "../../doc/api";
import {
  type RunPropertiesPatch,
  applyRunPropertiesToRuns,
  mergeAdjacentTextRuns,
  splitRunsAt,
} from "../../doc/runs";
import type {
  DrawingRun,
  InlineRun,
  Paragraph,
  ParagraphProperties,
  RevisionMark,
} from "../../doc/types";
import type { EditorContext } from "../context";
import {
  caretRangeFromPoint,
  closestBlockElement,
  currentDomRangeInsideHosts,
  hasImageInDataTransfer,
  readImageDimensions,
  unwrap,
} from "../dom";
import {
  type Mutation,
  allocateMediaPath,
  mimeToExtension,
  pxToEmu,
  wrapTagToPatch,
} from "../internal/mutations";
import { snapshotFormatRevision, stampDeleteRevision, stampInsertRevision } from "../revisionRuns";
import type { WrapTag } from "../types";
import * as parts from "./parts";

/**
 * Inline (run-level) mutations — run properties, wrapping, run/image
 * insertion, paragraph split, and range deletion — plus the image
 * clipboard/drag handlers. `mutateRunsInRange` is the shared engine that
 * applies a run transform to the slice a range covers (single- or
 * multi-block); it's exported because the review module reuses it for
 * accept/reject. Track-changes mode stamps `ins`/`del`/`revisionFormat`
 * markers instead of mutating text outright.
 */

/** Apply run-level properties across `range`. */
export function applyRunProperties(
  ctx: EditorContext,
  range: ApiRange,
  patch: RunPropertiesPatch,
  opts: { expect?: Record<string, number> } = {},
): EditResult<void> {
  ctx.ensureCurrent();
  const lockCheck = ctx.checkRange(range, opts.expect);
  if (lockCheck) return lockCheck;
  if (ctx.trackChanges.enabled) {
    const author = ctx.trackChanges.author;
    return mutateRunsInRange(ctx, range, (runs) => {
      const snapshotted = runs.map((r) => snapshotFormatRevision(r, author));
      return applyRunPropertiesToRuns(snapshotted, patch);
    });
  }
  return mutateRunsInRange(ctx, range, (runs) => applyRunPropertiesToRuns(runs, patch));
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
 * Insert a run at `at`. Splits the run list at the offset. In
 * track-changes mode the run is stamped `revision: ins` (unless it
 * already carries one — caller-provided revisions win).
 */
export function insertRun(
  ctx: EditorContext,
  at: InlinePosition,
  run: InlineRun,
): EditResult<BlockRef> {
  ctx.ensureCurrent();
  const lockCheck = ctx.checkRefs([at.block]);
  if (lockCheck) return lockCheck;
  const index = ctx.registry.indexOf(at.block.id);
  const block = ctx.doc.body[index];
  if (!block || block.kind !== "paragraph") {
    return fail({ code: "invalid-position", details: "target is not a paragraph" });
  }
  const stamped = ctx.trackChanges.enabled
    ? stampInsertRevision(run, ctx.trackChanges.author)
    : run;
  const { before, after } = splitRunsAt(block.runs, at.offset);
  const merged = mergeAdjacentTextRuns([...before, stamped, ...after]);
  const next = ctx.doc.body.slice();
  next[index] = { ...block, runs: merged };
  return ctx.commit({ body: next }, [{ type: "bump", index }]);
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
  const lockCheck = ctx.checkRange(range, opts.expect);
  if (lockCheck) return lockCheck;
  if (range.from.block.id !== range.to.block.id) {
    return ctx.trackChanges.enabled
      ? deleteRangeAcrossBlocksTracked(ctx, range)
      : deleteRangeAcrossBlocksPlain(ctx, range);
  }
  if (ctx.trackChanges.enabled) {
    const author = ctx.trackChanges.author;
    return mutateRunsInRange(ctx, range, (runs) =>
      runs.flatMap((r) => stampDeleteRevision(r, author)),
    );
  }
  return mutateRunsInRange(ctx, range, () => []);
}

/**
 * Tracked cross-paragraph delete. Stamps `del` on the affected runs of
 * each paragraph and the paragraph-mark of every block after the first,
 * so `acceptAllRevisions` later merges them into the first block.
 */
function deleteRangeAcrossBlocksTracked(ctx: EditorContext, range: ApiRange): EditResult<void> {
  const fromIdx = ctx.registry.indexOf(range.from.block.id);
  const toIdx = ctx.registry.indexOf(range.to.block.id);
  if (fromIdx < 0 || toIdx < 0 || fromIdx > toIdx) {
    return fail({ code: "range-out-of-order", details: "range endpoints" });
  }
  const author = ctx.trackChanges.author;
  const nextBody = ctx.doc.body.slice();
  const bumps: Mutation[] = [];

  for (let i = fromIdx; i <= toIdx; i++) {
    const block = nextBody[i];
    if (!block || block.kind !== "paragraph") continue;

    let newRuns: InlineRun[];
    if (i === fromIdx) {
      const split = splitRunsAt(block.runs, range.from.offset);
      const tailStamped = split.after.flatMap((r) => stampDeleteRevision(r, author));
      newRuns = mergeAdjacentTextRuns([...split.before, ...tailStamped]);
    } else if (i === toIdx) {
      const split = splitRunsAt(block.runs, range.to.offset);
      const headStamped = split.before.flatMap((r) => stampDeleteRevision(r, author));
      newRuns = mergeAdjacentTextRuns([...headStamped, ...split.after]);
    } else {
      newRuns = mergeAdjacentTextRuns(block.runs.flatMap((r) => stampDeleteRevision(r, author)));
    }

    let nextBlock: Paragraph = { ...block, runs: newRuns };

    // Stamp paragraph-mark del on every block AFTER the first — the
    // break between i-1 and i is part of the deletion. Skip if a
    // revision is already present (don't overwrite peer markers).
    if (i > fromIdx && !block.properties.revision) {
      const revision: RevisionMark =
        author === undefined ? { type: "del" } : { type: "del", author };
      nextBlock = {
        ...nextBlock,
        properties: { ...nextBlock.properties, revision },
      };
    }

    nextBody[i] = nextBlock;
    bumps.push({ type: "bump", index: i });
  }

  return ctx.commit({ body: nextBody }, bumps);
}

/**
 * Non-tracked cross-paragraph delete. Keeps the head of the first block
 * + the tail of the last, splices them into the first as one paragraph,
 * and removes everything in between.
 */
function deleteRangeAcrossBlocksPlain(ctx: EditorContext, range: ApiRange): EditResult<void> {
  const fromIdx = ctx.registry.indexOf(range.from.block.id);
  const toIdx = ctx.registry.indexOf(range.to.block.id);
  if (fromIdx < 0 || toIdx < 0 || fromIdx > toIdx) {
    return fail({ code: "range-out-of-order", details: "range endpoints" });
  }
  const first = ctx.doc.body[fromIdx];
  const last = ctx.doc.body[toIdx];
  if (!first || first.kind !== "paragraph" || !last || last.kind !== "paragraph") {
    return fail({
      code: "invalid-state",
      details: "cross-block delete requires paragraph endpoints",
    });
  }
  const head = splitRunsAt(first.runs, range.from.offset).before;
  const tail = splitRunsAt(last.runs, range.to.offset).after;
  const merged = mergeAdjacentTextRuns([...head, ...tail]);

  const nextBody = ctx.doc.body.slice();
  nextBody[fromIdx] = { ...first, runs: merged };
  nextBody.splice(fromIdx + 1, toIdx - fromIdx);
  if (nextBody.length === 0) {
    nextBody.push({ kind: "paragraph", properties: {}, runs: [] });
  }

  const mutations: Mutation[] = [{ type: "bump", index: fromIdx }];
  // Top-down removes so each index stays valid as the array shrinks.
  for (let i = toIdx; i > fromIdx; i--) {
    mutations.push({ type: "remove", index: i });
  }
  return ctx.commit({ body: nextBody }, mutations);
}

/**
 * Apply a runs transform to the runs covered by `range`. Handles single-
 * and multi-block ranges. Assumes locks have already been checked.
 * Exported for reuse by the review (accept/reject) module.
 */
export function mutateRunsInRange(
  ctx: EditorContext,
  range: ApiRange,
  transform: (runs: InlineRun[]) => InlineRun[],
): EditResult<void> {
  const fromIdx = ctx.registry.indexOf(range.from.block.id);
  const toIdx = ctx.registry.indexOf(range.to.block.id);
  if (fromIdx < 0 || toIdx < 0 || fromIdx > toIdx) {
    return fail({ code: "range-out-of-order", details: "range endpoints" });
  }
  const nextBody = ctx.doc.body.slice();
  const bumps: Mutation[] = [];

  if (fromIdx === toIdx) {
    const block = nextBody[fromIdx];
    if (!block || block.kind !== "paragraph") {
      return fail({
        code: "invalid-state",
        details: `block ${range.from.block.id} not a paragraph`,
      });
    }
    if (range.from.offset === range.to.offset) {
      return fail({ code: "range-empty", details: "zero-width range" });
    }
    const headSplit = splitRunsAt(block.runs, range.from.offset);
    const tailSplit = splitRunsAt(headSplit.after, range.to.offset - range.from.offset);
    const middle = transform(tailSplit.before);
    const merged = mergeAdjacentTextRuns([...headSplit.before, ...middle, ...tailSplit.after]);
    nextBody[fromIdx] = { ...block, runs: merged };
    bumps.push({ type: "bump", index: fromIdx });
  } else {
    // Multi-block range: first block's tail, all middle blocks, last
    // block's head get transformed.
    for (let i = fromIdx; i <= toIdx; i++) {
      const block = nextBody[i];
      if (!block || block.kind !== "paragraph") continue;
      let newRuns: InlineRun[];
      if (i === fromIdx) {
        const split = splitRunsAt(block.runs, range.from.offset);
        newRuns = mergeAdjacentTextRuns([...split.before, ...transform(split.after)]);
      } else if (i === toIdx) {
        const split = splitRunsAt(block.runs, range.to.offset);
        newRuns = mergeAdjacentTextRuns([...transform(split.before), ...split.after]);
      } else {
        newRuns = mergeAdjacentTextRuns(transform(block.runs));
      }
      nextBody[i] = { ...block, runs: newRuns };
      bumps.push({ type: "bump", index: i });
    }
  }
  return ctx.commit({ body: nextBody }, bumps);
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
