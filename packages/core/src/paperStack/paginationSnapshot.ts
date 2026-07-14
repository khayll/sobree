/**
 * A validatable memory of the last pagination result, so `repaginate` can
 * PROVE a re-flow is unnecessary and skip it. This is the "incremental
 * pagination" fast path (PR 3a of `devdocs/plan-model-first-editing.md`):
 * the overwhelmingly common edit — typing a character that doesn't wrap —
 * moves no page break, and re-collecting + re-measuring + re-distributing
 * every block on every keystroke is pure waste.
 *
 * The safety argument, per entry:
 *
 *   - **Same element reference + same `offsetHeight`.** Reference identity is
 *     what distinguishes the native-typing path (the browser mutates a block
 *     IN PLACE, so its node survives) from an API commit (which re-renders,
 *     minting fresh nodes / collapsing everything into paper 0). A block whose
 *     node reference AND height are unchanged occupies the exact same vertical
 *     space it did last pagination.
 *   - **Unchanged height ⟹ unchanged line count** (line height is constant
 *     within a block), so the paginator's per-line break CANDIDATES inside the
 *     block are identical — a break can't move for a block that lives wholly
 *     on one page, even if its TEXT changed (that edit is already in the DOM).
 *   - **The one hole: split fragments.** A paragraph/list/table that straddles
 *     a page boundary is rendered as sibling fragments in different papers
 *     (sharing a `data-pag-*` id). Editing one fragment can shift where text
 *     belongs across the boundary at CONSTANT height, which a full re-flow
 *     would re-split differently. Column containers (`sobree-cols`) balance
 *     content across tracks and have the same constant-height hazard. For
 *     those elements only, we additionally require unchanged `textContent`.
 *
 * When every entry passes, a full re-flow would reproduce the current DOM
 * exactly, so skipping it is byte-identical — the invariant the PR guards.
 * Anything the snapshot can't prove safe (a changed height, a new/removed/
 * re-ordered block, a changed budget) falls through to the full `repaginate`.
 */

/** Height probe. Defaults to `offsetHeight`; injectable so the pure compare
 *  logic is unit-testable under jsdom (which has no layout — every offset is
 *  0). */
export type MeasureHeight = (el: HTMLElement) => number;

const domHeight: MeasureHeight = (el) => el.offsetHeight;

interface SnapshotEntry {
  el: HTMLElement;
  height: number;
  /** `textContent` at snapshot time — recorded ONLY for elements whose
   *  placement can change at constant height (split fragments, column
   *  containers). `undefined` ⇒ height-alone is a sufficient guard. */
  volatileText?: string;
}

export interface PaginationSnapshot {
  budgetPx: number;
  entries: SnapshotEntry[];
}

/** The `data-pag-*` id a split fragment carries; siblings of the same logical
 *  block share it across papers. `undefined` for an unsplit block. */
function splitKey(el: HTMLElement): string | undefined {
  return el.dataset.pagPid ?? el.dataset.pagLid ?? el.dataset.pagTid;
}

/** Count how many collected elements share each split id, so a fragment can be
 *  told (count > 1) from a whole block that merely carries a pid (count === 1). */
function countSplitKeys(blocks: readonly HTMLElement[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const el of blocks) {
    const key = splitKey(el);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Whether this element's placement can change at CONSTANT height — i.e. it
 *  needs the extra `textContent` guard on top of the height check. */
function isVolatile(el: HTMLElement, splitCounts: Map<string, number>): boolean {
  if (el.classList.contains("sobree-cols")) return true;
  const key = splitKey(el);
  return key !== undefined && (splitCounts.get(key) ?? 0) > 1;
}

/**
 * Record the current top-level block layout as a snapshot to validate the
 * next `repaginate` against. `blocks` is the flat, document-order list of
 * every paper's top-level content children (what `paginateBlocks` operates
 * on); `budgetPx` is the baseline page-content height.
 */
export function capturePaginationSnapshot(
  blocks: readonly HTMLElement[],
  budgetPx: number,
  measure: MeasureHeight = domHeight,
): PaginationSnapshot {
  const splitCounts = countSplitKeys(blocks);
  const entries = blocks.map((el) => {
    const entry: SnapshotEntry = { el, height: measure(el) };
    if (isVolatile(el, splitCounts)) entry.volatileText = el.textContent ?? "";
    return entry;
  });
  return { budgetPx, entries };
}

/**
 * True when the current layout matches `snap` closely enough that a full
 * re-flow would be a no-op — the signal `repaginate` uses to skip. Any
 * mismatch (budget, block set/order, a changed height, or a split/column
 * element whose text moved) returns false ⇒ full re-flow.
 */
export function paginationUnchanged(
  snap: PaginationSnapshot,
  blocks: readonly HTMLElement[],
  budgetPx: number,
  measure: MeasureHeight = domHeight,
): boolean {
  if (budgetPx !== snap.budgetPx) return false;
  if (blocks.length !== snap.entries.length) return false;
  for (let i = 0; i < blocks.length; i++) {
    const cur = blocks[i]!;
    const entry = snap.entries[i]!;
    // Reference identity first — a re-render replaces nodes even when the
    // rendered height is coincidentally equal, and that MUST re-flow.
    if (cur !== entry.el) return false;
    if (measure(cur) !== entry.height) return false;
    if (entry.volatileText !== undefined && (cur.textContent ?? "") !== entry.volatileText) {
      return false;
    }
  }
  return true;
}

/**
 * Whether two snapshots describe the same measured layout, IGNORING node
 * identity. This is the fixpoint test for ARMING: `repaginate` is not
 * idempotent — a single pass consolidates, re-merges split fragments,
 * re-measures the whole paragraph, and re-splits, which can land a break one
 * line differently than the split-fragment state it started from. So the FIRST
 * re-flow after a load/edit may be a non-converged intermediate; a subsequent
 * re-flow moves the break again. Arming the skip snapshot on such an
 * intermediate would freeze it (a wrong skip).
 *
 * We only arm when a re-flow left the layout unchanged from the state right
 * before it — proving that state is a fixpoint (`reflow(post) === post`), so a
 * later skip against it reproduces exactly what a re-flow would. Node
 * references are ignored because a re-flow mints fresh fragment nodes even when
 * the geometry is identical; height + (for split/column elements) text is what
 * determines the break positions.
 */
export function layoutStable(a: PaginationSnapshot, b: PaginationSnapshot): boolean {
  if (a.budgetPx !== b.budgetPx) return false;
  if (a.entries.length !== b.entries.length) return false;
  for (let i = 0; i < a.entries.length; i++) {
    const ea = a.entries[i]!;
    const eb = b.entries[i]!;
    if (ea.height !== eb.height) return false;
    if (ea.volatileText !== eb.volatileText) return false;
  }
  return true;
}
