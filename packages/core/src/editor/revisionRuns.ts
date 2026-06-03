/**
 * Pure run-level transforms for tracked changes. Each takes an
 * `InlineRun` (+ author / decision) and returns the rewritten run(s) —
 * no editor state, no DOM. Shared by the Editor's authoring
 * (`insertRun` / `deleteRange` / `applyRunProperties` in track-changes
 * mode) and review (`accept*` / `reject*`) paths.
 *
 * All follow the same text-only contract: non-text runs (drawings,
 * breaks, tabs) pass through unchanged.
 */

import type { InlineRun, RevisionMark } from "../doc/types";

/**
 * Resolve one run against an accept/reject decision on its tracked
 * change. Returns the replacement run list — `[run]` unchanged,
 * `[stripped]` to keep the text minus the revision marker, or `[]` to
 * drop the run entirely.
 *
 *   accept + ins → keep text, strip marker     (insertion confirmed)
 *   accept + del → drop run                    (deletion applied)
 *   reject + ins → drop run                    (insertion undone)
 *   reject + del → keep text, strip marker     (deletion undone)
 *
 * Non-text runs and runs with no `revision` pass through untouched.
 */
export function decideRevisionRun(run: InlineRun, decision: "accept" | "reject"): InlineRun[] {
  if (run.kind !== "text") return [run];
  const rev = run.properties.revision;
  if (!rev) return [run];
  const keepText =
    (decision === "accept" && rev.type === "ins") || (decision === "reject" && rev.type === "del");
  if (!keepText) return [];
  const { revision: _dropped, ...rest } = run.properties;
  return [{ ...run, properties: rest }];
}

/**
 * Authoring helper for `insertRun` in track-changes mode. Stamps an
 * `ins` revision on the run if it doesn't already carry one — a caller
 * providing a pre-stamped run (e.g. an import code path replaying a
 * revision) wins. Mirrors `decideRevisionRun`'s text-only contract:
 * non-text runs (drawings, breaks, tabs, …) pass through unchanged in
 * v1 — Word does track drawing inserts as revisions, but layering that
 * on the non-uniform `properties` shape of non-text runs is a follow-up.
 */
export function stampInsertRevision(run: InlineRun, author: string | undefined): InlineRun {
  if (run.kind !== "text") return run;
  if (run.properties.revision) return run;
  const revision: RevisionMark = author === undefined ? { type: "ins" } : { type: "ins", author };
  return { ...run, properties: { ...run.properties, revision } };
}

/**
 * Consumption helper for `acceptFormatRevision` / `rejectFormatRevision`.
 *
 *   accept → drop `revisionFormat`; current `properties` stay.
 *   reject → restore `properties` to `revisionFormat.before`; the
 *            snapshot is then dropped too (the run is back to its
 *            pre-tracking state and there's nothing to undo).
 *
 * Runs without a `revisionFormat` snapshot pass through unchanged.
 */
export function decideFormatRun(run: InlineRun, decision: "accept" | "reject"): InlineRun {
  if (run.kind !== "text") return run;
  const rf = run.properties.revisionFormat;
  if (!rf) return run;
  if (decision === "accept") {
    const { revisionFormat: _drop, ...rest } = run.properties;
    return { ...run, properties: rest };
  }
  // reject — restore the snapshot, and drop the marker.
  return { ...run, properties: rf.before };
}

/**
 * Authoring helper for `applyRunProperties` in track-changes mode.
 * Captures the run's current `properties` (excluding any existing
 * `revisionFormat` so the snapshot stays self-contained) as
 * `revisionFormat.before` if no snapshot is already in place.
 * Subsequent tracked format edits skip re-snapshotting — the *original*
 * pre-tracking state always wins on reject.
 */
export function snapshotFormatRevision(run: InlineRun, author: string | undefined): InlineRun {
  if (run.kind !== "text") return run;
  if (run.properties.revisionFormat) return run;
  const { revisionFormat: _ignored, ...before } = run.properties;
  const stamp = author === undefined ? { before } : { before, author };
  return { ...run, properties: { ...run.properties, revisionFormat: stamp } };
}

/**
 * Authoring helper for `deleteRange` in track-changes mode. Per the
 * `TrackChangesState` semantics, applied per text run in range:
 *   - plain run (no revision)               → stamp `del`
 *   - already-pending `ins` by same author  → drop the run (cancel)
 *   - everything else (peer revision, peer
 *     `del`, anything pre-marked)           → leave untouched
 * Non-text runs pass through unchanged (same text-only contract as
 * `stampInsertRevision`).
 */
export function stampDeleteRevision(run: InlineRun, author: string | undefined): InlineRun[] {
  if (run.kind !== "text") return [run];
  const rev = run.properties.revision;
  if (!rev) {
    const revision: RevisionMark = author === undefined ? { type: "del" } : { type: "del", author };
    return [{ ...run, properties: { ...run.properties, revision } }];
  }
  if (rev.type === "ins" && rev.author === author) {
    return [];
  }
  return [run];
}
