/**
 * Pure tracked-change review engine — enumerate revisions and accept/reject
 * the inline + format ones over a range. The *consumption* side of tracked
 * changes (the *authoring* side — `insertRun`/`deleteRange` stamping — lives
 * in `./runs.ts`). Shared by the browser `Editor` and `HeadlessSobree`.
 *
 * Sits above `./runs` (range engine) and `./revisions` (per-run decisions);
 * neither imports back, so there's no cycle. Paragraph-mark accept/reject
 * (which merges blocks) and accept-all stay on the editor for now.
 */

import type { Range as ApiRange, BlockRef } from "../api";
import { runLength, runsLength } from "../runs";
import type { Paragraph } from "../types";
import { decideFormatRun, decideRevisionRun } from "./revisions";
import { checkRangeRefs, mutateRunsInRangeMutation } from "./runs";
import type { BlockRegistryView, DocumentMutationResult, MutationInput } from "./types";

/**
 * One logical tracked change — a maximal run of consecutive inline runs
 * that all carry a `revision` marker by the same author. `getRevisions()`
 * returns these; pass `range` straight to `acceptRevision` / `rejectRevision`.
 *
 * `kinds` is the set of revision types in the span: `["ins"]` or `["del"]`
 * for a plain change, both for a delete-then-insert replacement (which
 * accepts/rejects as a single unit).
 */
export interface RevisionSpan {
  range: ApiRange;
  author?: string;
  kinds: ("ins" | "del")[];
  /** ISO date of the span's first revision run, if recorded. */
  date?: string;
  /**
   * Discriminator between revision levels:
   *   `"inline"` (default for backwards compat) — the span covers
   *     `ins`/`del` text runs inside a block. Pass `range` to
   *     `acceptRevision` / `rejectRevision`.
   *   `"paragraph"` — the span flags the *paragraph mark* itself on
   *     `range.from.block`. The range covers offset `[0, length]` of
   *     the block so it still selects the right element for UIs, but
   *     accept/reject must go through `acceptParagraphRevision` /
   *     `rejectParagraphRevision`.
   *   `"format"` — the span flags a tracked format change
   *     (`<w:rPrChange>`) on contiguous runs by the same author.
   *     `kinds` always reports `["ins"]` (the marker is binary: a
   *     format change exists or not). Pass `range` to
   *     `acceptFormatRevision` / `rejectFormatRevision`.
   */
  level?: "inline" | "paragraph" | "format";
}

/**
 * Enumerate every logical tracked change. Consecutive revision-bearing runs
 * by the same author coalesce into one `RevisionSpan`; each span carries a
 * fresh versioned ref ready for accept/reject. Re-query after each change —
 * the ranges are positional.
 */
export function getRevisionsFromDoc(
  doc: MutationInput["doc"],
  registry: BlockRegistryView,
): RevisionSpan[] {
  const spans: RevisionSpan[] = [];
  for (let i = 0; i < doc.body.length; i++) {
    const block = doc.body[i];
    if (!block) continue;
    if (block.kind === "table") {
      // Walk into table cells. Cell paragraphs aren't registry-tracked, so
      // we surface their revisions under the containing table's ref.
      const tableRef = registry.refAt(i);
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
    collectParagraphRevisions(block, registry.refAt(i), spans);
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
      range: { from: { block: ref, offset: 0 }, to: { block: ref, offset: length } },
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
      range: { from: { block: ref, offset: open.start }, to: { block: ref, offset: open.end } },
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

/** Accept the tracked changes inside `range`: insertions become permanent
 *  (marker stripped, text kept), deletions are applied (text dropped). */
export function acceptRevisionMutation(
  input: MutationInput,
  range: ApiRange,
  expect?: Record<string, number>,
): DocumentMutationResult<void> {
  const lock = checkRangeRefs(input.registry, range, expect);
  if (lock) return lock;
  return mutateRunsInRangeMutation(input, range, (runs) =>
    runs.flatMap((r) => decideRevisionRun(r, "accept")),
  );
}

/** Reject the tracked changes inside `range`. Inverse of accept. */
export function rejectRevisionMutation(
  input: MutationInput,
  range: ApiRange,
  expect?: Record<string, number>,
): DocumentMutationResult<void> {
  const lock = checkRangeRefs(input.registry, range, expect);
  if (lock) return lock;
  return mutateRunsInRangeMutation(input, range, (runs) =>
    runs.flatMap((r) => decideRevisionRun(r, "reject")),
  );
}

/** Accept tracked format changes inside `range` (drop the snapshot). */
export function acceptFormatRevisionMutation(
  input: MutationInput,
  range: ApiRange,
  expect?: Record<string, number>,
): DocumentMutationResult<void> {
  const lock = checkRangeRefs(input.registry, range, expect);
  if (lock) return lock;
  return mutateRunsInRangeMutation(input, range, (runs) =>
    runs.map((r) => decideFormatRun(r, "accept")),
  );
}

/** Reject tracked format changes inside `range` (revert to `before`). */
export function rejectFormatRevisionMutation(
  input: MutationInput,
  range: ApiRange,
  expect?: Record<string, number>,
): DocumentMutationResult<void> {
  const lock = checkRangeRefs(input.registry, range, expect);
  if (lock) return lock;
  return mutateRunsInRangeMutation(input, range, (runs) =>
    runs.map((r) => decideFormatRun(r, "reject")),
  );
}
