import { type Range as ApiRange, type BlockRef, type EditResult, fail, ok } from "../../doc/api";
import { mergeAdjacentTextRuns, runLength, runsLength } from "../../doc/runs";
import type {
  Block,
  InlineRun,
  Paragraph,
  RevisionMark,
  Table,
  TableCell,
  TableRow,
} from "../../doc/types";
import type { EditorContext } from "../context";
import * as query from "../query";
import { decideFormatRun, decideRevisionRun } from "../revisionRuns";
import type { RevisionSpan } from "../types";
import { mutateRunsInRange } from "./runs";

/**
 * Tracked-change review: accept/reject of inline, format, and
 * paragraph-mark revisions (single-range, paragraph-level, or
 * whole-document), plus `getRevisions` which enumerates every logical
 * change as coalesced `RevisionSpan`s. The run-level decisions reuse the
 * pure transforms in `revisionRuns`; the engine is `mutateRunsInRange`
 * (shared with the authoring path in `ops/runs`).
 */

/**
 * Accept the tracked changes inside `range`: insertions become permanent
 * (marker stripped, text kept), deletions are applied (text dropped).
 * Runs with no revision pass through, so a slightly-wider range is safe.
 */
export function acceptRevision(
  ctx: EditorContext,
  range: ApiRange,
  opts: { expect?: Record<string, number> } = {},
): EditResult<void> {
  ctx.ensureCurrent();
  const lockCheck = ctx.checkRange(range, opts.expect);
  if (lockCheck) return lockCheck;
  return mutateRunsInRange(ctx, range, (runs) =>
    runs.flatMap((r) => decideRevisionRun(r, "accept")),
  );
}

/** Reject the tracked changes inside `range`. Inverse of `acceptRevision`. */
export function rejectRevision(
  ctx: EditorContext,
  range: ApiRange,
  opts: { expect?: Record<string, number> } = {},
): EditResult<void> {
  ctx.ensureCurrent();
  const lockCheck = ctx.checkRange(range, opts.expect);
  if (lockCheck) return lockCheck;
  return mutateRunsInRange(ctx, range, (runs) =>
    runs.flatMap((r) => decideRevisionRun(r, "reject")),
  );
}

/** Accept tracked format changes inside `range` (drop the snapshot). */
export function acceptFormatRevision(
  ctx: EditorContext,
  range: ApiRange,
  opts: { expect?: Record<string, number> } = {},
): EditResult<void> {
  ctx.ensureCurrent();
  const lockCheck = ctx.checkRange(range, opts.expect);
  if (lockCheck) return lockCheck;
  return mutateRunsInRange(ctx, range, (runs) => runs.map((r) => decideFormatRun(r, "accept")));
}

/** Reject tracked format changes inside `range` (revert to `before`). */
export function rejectFormatRevision(
  ctx: EditorContext,
  range: ApiRange,
  opts: { expect?: Record<string, number> } = {},
): EditResult<void> {
  ctx.ensureCurrent();
  const lockCheck = ctx.checkRange(range, opts.expect);
  if (lockCheck) return lockCheck;
  return mutateRunsInRange(ctx, range, (runs) => runs.map((r) => decideFormatRun(r, "reject")));
}

/**
 * Accept the paragraph-mark revision on `target`:
 *   - `ins` → strip the marker; the paragraph break stays permanent.
 *   - `del` → merge this paragraph's content into the *previous* one.
 */
export function acceptParagraphRevision(ctx: EditorContext, target: BlockRef): EditResult<void> {
  ctx.ensureCurrent();
  const lockCheck = ctx.checkRefs([target]);
  if (lockCheck) return lockCheck;
  const index = ctx.registry.indexOf(target.id);
  const block = ctx.doc.body[index];
  if (!block || block.kind !== "paragraph") {
    return fail({ code: "invalid-position", details: "target is not a paragraph" });
  }
  const rev = block.properties.revision;
  if (!rev) {
    return fail({ code: "range-empty", details: "no paragraph-level revision to accept" });
  }
  if (rev.type === "ins") {
    const { revision: _strip, ...rest } = block.properties;
    const next = ctx.doc.body.slice();
    next[index] = { ...block, properties: rest };
    return ctx.commit({ body: next }, [{ type: "bump", index }]);
  }
  // del → merge into previous paragraph (the break is consumed).
  return mergeWithPrevious(ctx, index);
}

/**
 * Reject the paragraph-mark revision on `target`:
 *   - `ins` → merge this paragraph into the *previous* (undo the split).
 *   - `del` → strip the marker; the paragraph break stays.
 */
export function rejectParagraphRevision(ctx: EditorContext, target: BlockRef): EditResult<void> {
  ctx.ensureCurrent();
  const lockCheck = ctx.checkRefs([target]);
  if (lockCheck) return lockCheck;
  const index = ctx.registry.indexOf(target.id);
  const block = ctx.doc.body[index];
  if (!block || block.kind !== "paragraph") {
    return fail({ code: "invalid-position", details: "target is not a paragraph" });
  }
  const rev = block.properties.revision;
  if (!rev) {
    return fail({ code: "range-empty", details: "no paragraph-level revision to reject" });
  }
  if (rev.type === "del") {
    const { revision: _strip, ...rest } = block.properties;
    const next = ctx.doc.body.slice();
    next[index] = { ...block, properties: rest };
    return ctx.commit({ body: next }, [{ type: "bump", index }]);
  }
  // ins → undo the split: merge into previous paragraph.
  return mergeWithPrevious(ctx, index);
}

/**
 * Concatenate `body[index]`'s runs onto `body[index-1]` and remove
 * `body[index]`. The previous block must be a paragraph (else
 * `invalid-state`). At index 0 the break is implicit, so we strip the
 * marker instead.
 */
function mergeWithPrevious(ctx: EditorContext, index: number): EditResult<void> {
  if (index <= 0) {
    return stripParagraphMarker(ctx, index);
  }
  const prev = ctx.doc.body[index - 1];
  const cur = ctx.doc.body[index];
  if (!prev || !cur || cur.kind !== "paragraph") {
    return fail({ code: "invalid-state", details: "current block is not a paragraph" });
  }
  if (prev.kind !== "paragraph") {
    return fail({
      code: "invalid-state",
      details: "previous block is not a paragraph — cross-kind merge unsupported",
    });
  }
  const next = ctx.doc.body.slice();
  next[index - 1] = {
    ...prev,
    runs: mergeAdjacentTextRuns([...prev.runs, ...cur.runs]),
  };
  next.splice(index, 1);
  if (next.length === 0) next.push({ kind: "paragraph", properties: {}, runs: [] });
  return ctx.commit({ body: next }, [
    { type: "bump", index: index - 1 },
    { type: "remove", index },
  ]);
}

/** Strip the `revision` marker from `body[index]`, leaving it in place. */
function stripParagraphMarker(ctx: EditorContext, index: number): EditResult<void> {
  const block = ctx.doc.body[index];
  if (!block || block.kind !== "paragraph") {
    return fail({ code: "invalid-position", details: "target is not a paragraph" });
  }
  if (!block.properties.revision) return ok<void>(undefined as void, []);
  const { revision: _strip, ...rest } = block.properties;
  const next = ctx.doc.body.slice();
  next[index] = { ...block, properties: rest };
  return ctx.commit({ body: next }, [{ type: "bump", index }]);
}

/**
 * Flag `body[index]`'s paragraph break as a tracked deletion. Used by
 * the Backspace-at-start-of-paragraph keystroke. Cancels the author's
 * own pending `ins` by merging instead; leaves peer revisions alone.
 */
export function markParagraphBreakForDelete(ctx: EditorContext, index: number): EditResult<void> {
  const block = ctx.doc.body[index];
  if (!block || block.kind !== "paragraph") {
    return fail({ code: "invalid-position", details: "target is not a paragraph" });
  }
  const author = ctx.trackChanges.author;
  const existing = block.properties.revision;
  if (existing?.type === "ins" && existing.author === author) {
    return mergeWithPrevious(ctx, index);
  }
  if (existing) {
    return ok<void>(undefined as void, []);
  }
  const revision: RevisionMark = author === undefined ? { type: "del" } : { type: "del", author };
  const next = ctx.doc.body.slice();
  next[index] = {
    ...block,
    properties: { ...block.properties, revision },
  };
  return ctx.commit({ body: next }, [{ type: "bump", index }]);
}

/**
 * Enumerate every logical tracked change. Consecutive revision-bearing
 * runs by the same author coalesce into one `RevisionSpan`; each span
 * carries fresh versioned refs ready for accept/reject. Re-query after
 * each `change` — the ranges are positional.
 */
export function getRevisions(ctx: EditorContext): RevisionSpan[] {
  ctx.ensureCurrent();
  const spans: RevisionSpan[] = [];
  for (let i = 0; i < ctx.doc.body.length; i++) {
    const block = ctx.doc.body[i];
    if (!block) continue;
    if (block.kind === "table") {
      // Walk into table cells. Cell paragraphs aren't registry-tracked,
      // so we surface their revisions under the containing table's ref.
      const info = query.getBlock(ctx, i);
      const tableRef: BlockRef = { id: info.id, version: info.version };
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const inner of cell.content) {
            if (inner.kind !== "paragraph") continue;
            collectParagraphRevisions(inner, tableRef, spans);
          }
        }
      }
      continue;
    }
    if (block.kind !== "paragraph") continue;
    const info = query.getBlock(ctx, i);
    const ref: BlockRef = { id: info.id, version: info.version };
    collectParagraphRevisions(block, ref, spans);
  }
  return spans;
}

/**
 * Walk one paragraph and append its revision spans to `out`. Emits a
 * three-level shape: paragraph-mark first, then coalesced inline ins/del
 * spans, then coalesced format-change spans.
 */
function collectParagraphRevisions(block: Paragraph, ref: BlockRef, out: RevisionSpan[]): void {
  const length = runsLength(block.runs);

  // Paragraph-mark
  const pRev = block.properties.revision;
  if (pRev) {
    out.push({
      range: {
        from: { block: ref, offset: 0 },
        to: { block: ref, offset: length },
      },
      ...(pRev.author !== undefined ? { author: pRev.author } : {}),
      kinds: [pRev.type],
      ...(pRev.date !== undefined ? { date: pRev.date } : {}),
      level: "paragraph",
    });
  }

  let offset = 0;
  let open: {
    start: number;
    end: number;
    author: string | undefined;
    kinds: Set<"ins" | "del">;
    date: string | undefined;
  } | null = null;
  let openFmt: {
    start: number;
    end: number;
    author: string | undefined;
    date: string | undefined;
  } | null = null;
  const flush = (): void => {
    if (!open) return;
    out.push({
      range: {
        from: { block: ref, offset: open.start },
        to: { block: ref, offset: open.end },
      },
      ...(open.author !== undefined ? { author: open.author } : {}),
      kinds: [...open.kinds],
      ...(open.date !== undefined ? { date: open.date } : {}),
      level: "inline",
    });
    open = null;
  };
  const flushFmt = (): void => {
    if (!openFmt) return;
    out.push({
      range: {
        from: { block: ref, offset: openFmt.start },
        to: { block: ref, offset: openFmt.end },
      },
      ...(openFmt.author !== undefined ? { author: openFmt.author } : {}),
      kinds: ["ins"],
      ...(openFmt.date !== undefined ? { date: openFmt.date } : {}),
      level: "format",
    });
    openFmt = null;
  };
  for (const run of block.runs) {
    const len = runLength(run);
    const rev = run.kind === "text" ? run.properties.revision : undefined;
    if (rev) {
      if (open && open.author === rev.author) {
        open.end = offset + len;
        open.kinds.add(rev.type);
      } else {
        flush();
        open = {
          start: offset,
          end: offset + len,
          author: rev.author,
          kinds: new Set<"ins" | "del">([rev.type]),
          date: rev.date,
        };
      }
    } else {
      flush();
    }
    const rf = run.kind === "text" ? run.properties.revisionFormat : undefined;
    if (rf) {
      if (openFmt && openFmt.author === rf.author) {
        openFmt.end = offset + len;
      } else {
        flushFmt();
        openFmt = { start: offset, end: offset + len, author: rf.author, date: rf.date };
      }
    } else {
      flushFmt();
    }
    offset += len;
  }
  flush();
  flushFmt();
}

/**
 * Accept every tracked change (optionally filtered by author). One
 * commit for the whole sweep.
 */
export function acceptAllRevisions(
  ctx: EditorContext,
  opts: { author?: string } = {},
): EditResult<void> {
  return applyAllRevisions(ctx, "accept", opts.author);
}

/** Reject every tracked change (optionally filtered by author). */
export function rejectAllRevisions(
  ctx: EditorContext,
  opts: { author?: string } = {},
): EditResult<void> {
  return applyAllRevisions(ctx, "reject", opts.author);
}

function applyAllRevisions(
  ctx: EditorContext,
  decision: "accept" | "reject",
  author: string | undefined,
): EditResult<void> {
  ctx.ensureCurrent();
  // Two passes:
  //   1. Inline + format revisions on every paragraph's runs.
  //   2. Paragraph-mark revisions, applied bottom-up so indices stay
  //      valid as paragraphs collapse.
  const nextBody = ctx.doc.body.slice();
  const bumps: { type: "bump" | "remove"; index: number }[] = [];
  const removes: number[] = [];

  for (let i = 0; i < nextBody.length; i++) {
    const block = nextBody[i];
    if (!block) continue;
    if (block.kind === "table") {
      const tableChanged = sweepTableCellRevisions(block, decision, author);
      if (tableChanged.changed) {
        nextBody[i] = tableChanged.next;
        bumps.push({ type: "bump", index: i });
      }
      continue;
    }
    if (block.kind !== "paragraph") continue;

    let changed = false;
    const newRuns = block.runs.flatMap((r) => {
      let next: InlineRun = r;
      const rev = r.kind === "text" ? r.properties.revision : undefined;
      if (rev && (author === undefined || rev.author === author)) {
        const decided = decideRevisionRun(next, decision);
        changed = true;
        if (decided.length === 0) return decided;
        next = decided[0]!;
      }
      const rf = next.kind === "text" ? next.properties.revisionFormat : undefined;
      if (rf && (author === undefined || rf.author === author)) {
        next = decideFormatRun(next, decision);
        changed = true;
      }
      return [next];
    });
    let nextBlock: Block = block;
    if (changed) {
      nextBlock = { ...block, runs: mergeAdjacentTextRuns(newRuns) };
    }

    const pRev = block.properties.revision;
    if (pRev && (author === undefined || pRev.author === author)) {
      const stripMarker =
        (decision === "accept" && pRev.type === "ins") ||
        (decision === "reject" && pRev.type === "del");
      if (stripMarker) {
        const { revision: _strip, ...rest } = (nextBlock as Paragraph).properties;
        nextBlock = { ...(nextBlock as Paragraph), properties: rest };
        changed = true;
      } else {
        // Schedule a merge — defer to second pass.
        removes.push(i);
        if (changed) nextBody[i] = nextBlock;
        continue;
      }
    }

    if (changed) {
      nextBody[i] = nextBlock;
      bumps.push({ type: "bump", index: i });
    }
  }

  // Second pass — paragraph-mark merges bottom-up. Merge-impossible
  // cases (first block, non-paragraph previous) strip the marker as a
  // best-effort fallback so the reviewer isn't trapped with unresolvable
  // dock items.
  if (removes.length > 0) {
    removes.sort((a, b) => b - a);
    for (const i of removes) {
      const cur = nextBody[i];
      if (!cur || cur.kind !== "paragraph") continue;
      const prev = i > 0 ? nextBody[i - 1] : null;
      const canMerge = prev != null && prev.kind === "paragraph";
      if (!canMerge) {
        if (cur.properties.revision) {
          const { revision: _strip, ...rest } = cur.properties;
          nextBody[i] = { ...cur, properties: rest };
          bumps.push({ type: "bump", index: i });
        }
        continue;
      }
      nextBody[i - 1] = {
        ...prev,
        runs: mergeAdjacentTextRuns([...prev.runs, ...cur.runs]),
      };
      nextBody.splice(i, 1);
      bumps.push({ type: "bump", index: i - 1 });
      bumps.push({ type: "remove", index: i });
    }
    if (nextBody.length === 0) nextBody.push({ kind: "paragraph", properties: {}, runs: [] });
  }

  if (bumps.length === 0) return ok<void>(undefined as void, []);
  return ctx.commit({ body: nextBody }, bumps);
}

/**
 * Walk a table's cell paragraphs and apply the decision to inline +
 * format + paragraph-mark revisions. Paragraph-mark del within a cell
 * falls back to strip-the-marker (cross-cell-paragraph merge is out of
 * v1 scope). Returns `{ next, changed }`.
 */
function sweepTableCellRevisions(
  table: Table,
  decision: "accept" | "reject",
  author: string | undefined,
): { next: Table; changed: boolean } {
  let anyChanged = false;
  const nextRows = table.rows.map(
    (row: TableRow): TableRow => ({
      ...row,
      cells: row.cells.map((cell: TableCell): TableCell => {
        let cellChanged = false;
        const nextContent: Block[] = cell.content.map((inner: Block): Block => {
          if (inner.kind !== "paragraph") return inner;
          let pChanged = false;
          const newRuns = inner.runs.flatMap((r) => {
            let next: InlineRun = r;
            const rev = r.kind === "text" ? r.properties.revision : undefined;
            if (rev && (author === undefined || rev.author === author)) {
              const decided = decideRevisionRun(next, decision);
              pChanged = true;
              if (decided.length === 0) return decided;
              next = decided[0]!;
            }
            const rf = next.kind === "text" ? next.properties.revisionFormat : undefined;
            if (rf && (author === undefined || rf.author === author)) {
              next = decideFormatRun(next, decision);
              pChanged = true;
            }
            return [next];
          });
          let nextPara: Paragraph = pChanged
            ? { ...inner, runs: mergeAdjacentTextRuns(newRuns) }
            : inner;
          const pRev = inner.properties.revision;
          if (pRev && (author === undefined || pRev.author === author)) {
            const { revision: _strip, ...rest } = nextPara.properties;
            nextPara = { ...nextPara, properties: rest };
            pChanged = true;
          }
          if (pChanged) {
            cellChanged = true;
            anyChanged = true;
          }
          return nextPara;
        });
        if (!cellChanged) return cell;
        return { ...cell, content: nextContent };
      }),
    }),
  );
  return { next: anyChanged ? { ...table, rows: nextRows } : table, changed: anyChanged };
}
