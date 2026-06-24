/**
 * Repagination retry orchestration — the algorithm that was inlined in
 * `PaperStack.repaginate`, lifted behind a {@link RepaginationHost} so the
 * loop is isolated and testable. All DOM lives on the host; this module
 * only sequences the steps and decides when the page set has converged.
 *
 * The step order is load-bearing (it mirrors what Word/LibreOffice do and
 * what the corpus baselines were captured against). Do not reorder.
 */

import { restoreSelection, saveSelection } from "../../util/selection";
import type { RepaginationHost } from "./types";

/** Cap on iterative repagination retries. Each iteration shrinks the
 *  budget by the observed overflow, so convergence is exponential —
 *  3 is plenty for any realistic doc and prevents accidental infinite
 *  loops on pathological content. */
export const MAX_REPAGINATE_RETRIES = 3;

/** "Is this page actually overflowing enough to warrant a re-pack?"
 *  Set to ~one body line — sub-line overflows are visually
 *  imperceptible and re-paginating to fix them tends to shift page
 *  breaks by a full line elsewhere, drifting AWAY from Word/LibreOffice
 *  break points rather than toward them. We only iterate when the
 *  overflow exceeds a typical line height. (~28px ≈ 21pt at 12pt
 *  body — covers the common case where split-slippage adds a line.) */
export const OVERFLOW_TOLERANCE_PX = 28;

/**
 * Redistribute blocks across papers until the page set is stable.
 *
 * 1. collect all blocks; if none, ensure one paper, render zones, emit, done.
 * 2. save selection; compute the baseline page-height budget.
 * 3. iterate (bounded by {@link MAX_REPAGINATE_RETRIES}):
 *      a. paginate once with the current per-page budgets,
 *      b. distribute footnotes (populates per-page zones),
 *      c. rebuild per-page budgets from observed footnote-zone heights,
 *      d. stop when the budgets are stable AND no paper overflows beyond
 *         {@link OVERFLOW_TOLERANCE_PX}.
 * 4. restore selection, render zones, apply per-section settings, emit.
 *
 * Each iteration's shrunken budget reserves footnote space, so the body
 * re-flows to fit; convergence is exponential.
 */
export function repaginate(host: RepaginationHost): void {
  const initialBlocks = host.collectAllBlocks();

  if (initialBlocks.length === 0) {
    host.ensurePaperCount(1);
    host.renderAllZones();
    host.emitPaginate();
    return;
  }

  const saved = saveSelection();
  const baselineBudgetPx = host.pageContentHeightPx();
  let pageHeights: number[] = [];
  for (let attempt = 0; attempt <= MAX_REPAGINATE_RETRIES; attempt++) {
    host.runPaginationOnce(baselineBudgetPx, pageHeights);
    host.distributeFootnotes();
    const newHeights = host.footnotePageHeights(baselineBudgetPx);
    const stable = arraysEqual(newHeights, pageHeights);
    pageHeights = newHeights;
    // Stable + no overflow → done. Stable + overflow shouldn't happen
    // (the shrunken budget already reserved footnote space), but guard
    // with the overflow check anyway.
    const overflowPx = host.maxPaperOverflowPx();
    if (stable && overflowPx <= OVERFLOW_TOLERANCE_PX) break;
  }

  restoreSelection(saved);
  host.renderAllZones();
  host.applyPerSectionSettings();
  host.emitPaginate();
}

function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
