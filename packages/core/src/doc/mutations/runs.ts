/**
 * Pure inline / range mutation engine — run properties, run insertion, and
 * range deletion, in both direct-edit and track-changes modes.
 *
 * This is the shared owner of the inline authoring decisions the browser
 * `Editor` and `HeadlessSobree` both perform. Each function takes a
 * {@link MutationInput} (+ range / position + options) and returns a
 * {@link DocumentMutationResult} — the adapter owns commit, selection,
 * DOM, and Y.Doc mirroring. No DOM / editor / Y.Doc imports (see
 * `./index.ts`).
 */

import { type Range as ApiRange, type BlockRef, type InlinePosition, fail } from "../api";
import {
  type RunPropertiesPatch,
  applyRunPropertiesToRuns,
  mergeAdjacentTextRuns,
  splitRunsAt,
} from "../runs";
import type { InlineRun, Paragraph, RevisionMark } from "../types";
import { paragraphTargetAt } from "./paragraphTarget";
import { snapshotFormatRevision, stampDeleteRevision, stampInsertRevision } from "./revisions";
import {
  type BlockRegistryView,
  type DocumentMutationResult,
  type Mutation,
  type MutationInput,
  checkRefs,
  okPatch,
} from "./types";

/**
 * Track-changes state the engine reads — a structural subset of the
 * editor's public `TrackChangesState` (which satisfies it directly). When
 * `enabled`, authoring mutations record `ins`/`del`/format revisions
 * instead of editing text outright; `author` stamps the marker.
 */
export interface TrackChangesInput {
  enabled: boolean;
  author?: string;
}

/**
 * Optimistic-lock check for a range: both endpoint blocks must be current,
 * plus any extra `expect` versions the caller pins. Mirrors the editor's
 * `checkRange`.
 */
export function checkRangeRefs(
  registry: BlockRegistryView,
  range: ApiRange,
  expect: Record<string, number> | undefined,
): ReturnType<typeof checkRefs> {
  const refs: BlockRef[] = [range.from.block, range.to.block];
  if (expect) {
    for (const [id, version] of Object.entries(expect)) refs.push({ id, version });
  }
  return checkRefs(registry, refs);
}

/**
 * Whether two positions address the same cell — true when neither is in a
 * cell (both plain body positions), false when only one is.
 */
function sameCell(a: InlinePosition, b: InlinePosition): boolean {
  if (!a.cell || !b.cell) return !a.cell && !b.cell;
  return (
    a.cell.row === b.cell.row &&
    a.cell.col === b.cell.col &&
    a.cell.blockIndex === b.cell.blockIndex
  );
}

/**
 * Apply a runs transform to the runs covered by `range` (single- or
 * multi-block). Assumes locks are already checked — the public entry
 * points ({@link applyRunPropertiesMutation}, {@link deleteRangeMutation})
 * validate first. Exported so the review accept/reject engine reuses it.
 */
export function mutateRunsInRangeMutation(
  input: MutationInput,
  range: ApiRange,
  transform: (runs: InlineRun[]) => InlineRun[],
): DocumentMutationResult<void> {
  const fromIdx = input.registry.indexOf(range.from.block.id);
  const toIdx = input.registry.indexOf(range.to.block.id);
  if (fromIdx < 0 || toIdx < 0 || fromIdx > toIdx) {
    return fail({ code: "range-out-of-order", details: "range endpoints" });
  }
  // A range from a cell out to another block (or across cells of different
  // tables) is a structural, multi-block edit the cell path doesn't model —
  // the loop below indexes `doc.body` directly and would rewrite the TABLE
  // block as if it were a paragraph. Decline; the caller falls back.
  if (fromIdx !== toIdx && (range.from.cell || range.to.cell)) {
    return fail({ code: "invalid-position", details: "range crosses a table cell boundary" });
  }
  const nextBody = input.doc.body.slice();
  const bumps: Mutation[] = [];

  if (fromIdx === toIdx) {
    // One paragraph — a body block, or one inside a table cell. A range
    // spanning two different cells of the same table shares the table's
    // block id and would land here too; `sameCell` sends it to the caller
    // to decline rather than silently rewriting one cell's runs.
    if (!sameCell(range.from, range.to)) {
      return fail({ code: "invalid-position", details: "range spans two cells" });
    }
    const target = paragraphTargetAt(input.doc, input.registry, range.from);
    if (!target) {
      return fail({
        code: "invalid-state",
        details: `block ${range.from.block.id} not a paragraph`,
      });
    }
    if (range.from.offset === range.to.offset) {
      return fail({ code: "range-empty", details: "zero-width range" });
    }
    const headSplit = splitRunsAt(target.paragraph.runs, range.from.offset);
    const tailSplit = splitRunsAt(headSplit.after, range.to.offset - range.from.offset);
    const middle = transform(tailSplit.before);
    const merged = mergeAdjacentTextRuns([...headSplit.before, ...middle, ...tailSplit.after]);
    return okPatch({ body: target.withParagraph({ ...target.paragraph, runs: merged }) }, [
      { type: "bump", index: target.index },
    ]);
  }
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
  return okPatch({ body: nextBody }, bumps);
}

/** Apply run-level properties across `range`. In track-changes mode each
 *  run's pre-edit formatting is snapshotted as a `revisionFormat`. */
export function applyRunPropertiesMutation(
  input: MutationInput,
  range: ApiRange,
  patch: RunPropertiesPatch,
  track: TrackChangesInput,
  expect?: Record<string, number>,
): DocumentMutationResult<void> {
  const lock = checkRangeRefs(input.registry, range, expect);
  if (lock) return lock;
  if (track.enabled) {
    const author = track.author;
    return mutateRunsInRangeMutation(input, range, (runs) => {
      const snapshotted = runs.map((r) => snapshotFormatRevision(r, author));
      return applyRunPropertiesToRuns(snapshotted, patch);
    });
  }
  return mutateRunsInRangeMutation(input, range, (runs) => applyRunPropertiesToRuns(runs, patch));
}

/**
 * Insert `run` at `at`. Splits the run list at the offset. In
 * track-changes mode the run is stamped `revision: ins` (unless it already
 * carries one — caller-provided revisions win). The returned patch bumps
 * the target block; the adapter surfaces its ref via `affected`.
 */
export function insertRunMutation(
  input: MutationInput,
  at: InlinePosition,
  run: InlineRun,
  track: TrackChangesInput,
): DocumentMutationResult<BlockRef> {
  const lock = checkRefs(input.registry, [at.block]);
  if (lock) return lock;
  // Resolves a body paragraph OR a paragraph inside a table cell; a cell
  // position bumps its TABLE, which rides the ordinary version model.
  const target = paragraphTargetAt(input.doc, input.registry, at);
  if (!target) {
    return fail({ code: "invalid-position", details: "target is not a paragraph" });
  }
  const stamped = track.enabled ? stampInsertRevision(run, track.author) : run;
  const { before, after } = splitRunsAt(target.paragraph.runs, at.offset);
  const merged = mergeAdjacentTextRuns([...before, stamped, ...after]);
  const next = target.withParagraph({ ...target.paragraph, runs: merged });
  return okPatch({ body: next }, [{ type: "bump", index: target.index }]);
}

/**
 * Delete the content inside `range` (single- or cross-block). In
 * track-changes mode the deletion is *recorded*: plain runs are stamped
 * `del`, a run already marked as the same author's pending `ins` is dropped
 * (cancelling an un-committed insert), peer revisions are left for
 * accept/reject. Cross-paragraph tracked deletes also stamp each later
 * paragraph-mark `del` so `acceptAllRevisions` collapses the range.
 */
export function deleteRangeMutation(
  input: MutationInput,
  range: ApiRange,
  track: TrackChangesInput,
  expect?: Record<string, number>,
): DocumentMutationResult<void> {
  const lock = checkRangeRefs(input.registry, range, expect);
  if (lock) return lock;
  if (range.from.block.id !== range.to.block.id) {
    // Cross-BLOCK deletes walk `doc.body` and merge paragraph marks; a cell
    // endpoint isn't a body paragraph, so decline rather than corrupt the
    // table. (Same-table cross-cell ranges share one block id and are caught
    // by `sameCell` in `mutateRunsInRangeMutation`.)
    if (range.from.cell || range.to.cell) {
      return fail({ code: "invalid-position", details: "range crosses a table cell boundary" });
    }
    return track.enabled
      ? deleteRangeAcrossBlocksTracked(input, range, track.author)
      : deleteRangeAcrossBlocksPlain(input, range);
  }
  if (track.enabled) {
    const author = track.author;
    return mutateRunsInRangeMutation(input, range, (runs) =>
      runs.flatMap((r) => stampDeleteRevision(r, author)),
    );
  }
  return mutateRunsInRangeMutation(input, range, () => []);
}

/**
 * Tracked cross-paragraph delete. Stamps `del` on the affected runs of each
 * paragraph and the paragraph-mark of every block after the first, so
 * `acceptAllRevisions` later merges them into the first block.
 */
function deleteRangeAcrossBlocksTracked(
  input: MutationInput,
  range: ApiRange,
  author: string | undefined,
): DocumentMutationResult<void> {
  const fromIdx = input.registry.indexOf(range.from.block.id);
  const toIdx = input.registry.indexOf(range.to.block.id);
  if (fromIdx < 0 || toIdx < 0 || fromIdx > toIdx) {
    return fail({ code: "range-out-of-order", details: "range endpoints" });
  }
  const nextBody = input.doc.body.slice();
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

    // Stamp paragraph-mark del on every block AFTER the first — the break
    // between i-1 and i is part of the deletion. Skip if a revision is
    // already present (don't overwrite peer markers).
    if (i > fromIdx && !block.properties.revision) {
      const revision: RevisionMark =
        author === undefined ? { type: "del" } : { type: "del", author };
      nextBlock = { ...nextBlock, properties: { ...nextBlock.properties, revision } };
    }

    nextBody[i] = nextBlock;
    bumps.push({ type: "bump", index: i });
  }

  return okPatch({ body: nextBody }, bumps);
}

/**
 * Non-tracked cross-paragraph delete. Keeps the head of the first block +
 * the tail of the last, splices them into the first as one paragraph, and
 * removes everything in between.
 */
function deleteRangeAcrossBlocksPlain(
  input: MutationInput,
  range: ApiRange,
): DocumentMutationResult<void> {
  const fromIdx = input.registry.indexOf(range.from.block.id);
  const toIdx = input.registry.indexOf(range.to.block.id);
  if (fromIdx < 0 || toIdx < 0 || fromIdx > toIdx) {
    return fail({ code: "range-out-of-order", details: "range endpoints" });
  }
  const first = input.doc.body[fromIdx];
  const last = input.doc.body[toIdx];
  if (!first || first.kind !== "paragraph" || !last || last.kind !== "paragraph") {
    return fail({
      code: "invalid-state",
      details: "cross-block delete requires paragraph endpoints",
    });
  }
  const head = splitRunsAt(first.runs, range.from.offset).before;
  const tail = splitRunsAt(last.runs, range.to.offset).after;
  const merged = mergeAdjacentTextRuns([...head, ...tail]);

  const nextBody = input.doc.body.slice();
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
  return okPatch({ body: nextBody }, mutations);
}
