/**
 * Score a corpus entry's rendering fidelity vs LibreOffice.
 *
 * Reduces the per-block drift report to a small set of numbers the CI
 * gate can compare against a committed baseline. Each metric captures
 * a different failure mode so a single composite "score went up by X"
 * doesn't hide WHICH dimension regressed.
 *
 * Metrics (all the "lower is better" direction):
 *   - `meanAbsDrift` — mean of |Sobree line-height − LibreOffice
 *     effective line-height| across matched blocks. The classic
 *     line-spacing drift number.
 *   - `pageCountDelta` — |Sobree pages − LibreOffice pages|. Catches
 *     pagination regressions immediately.
 *   - `matchedBlockRatio` — fraction of snapshot blocks that found at
 *     least one PDF line. A drop signals content not making it
 *     visually onto the page (clipped, mis-rendered).
 *
 * The baseline file lives at `<artifactDir>/baseline/score.json` and
 * commits the most recent measured values. The gate fails when any
 * metric exceeds `baseline + tolerance`.
 */

import type { FixtureDrift } from "../compare/types";

export interface CorpusScore {
  /** Mean of |line-height drift|; null if no multi-line blocks matched. */
  meanAbsDrift: number | null;
  /** Number of pages LibreOffice rendered. */
  libreofficePages: number;
  /** Number of pages Sobree's snapshot estimates. Filled from pages.json. */
  sobreePages: number | null;
  /** Absolute difference. Null when sobreePages unknown. */
  pageCountDelta: number | null;
  /** Total blocks in Sobree's snapshot. */
  blockCount: number;
  /** Blocks that matched at least one PDF line. */
  matchedBlocks: number;
  /** matchedBlocks / blockCount. Lower → content not landing. */
  matchedBlockRatio: number;
}

export const SCORE_TOLERANCE = {
  /** Allow up to 0.05 line-height multiplier units of drift before
   *  flagging — covers tiny font-metric differences across runs. */
  meanAbsDrift: 0.05,
  /** Pagination must match exactly. */
  pageCountDelta: 0,
  /** Allow a single missing block (e.g. a section break that happens
   *  to land between two PDF pages). */
  matchedBlockMin: 0.95,
};

export interface ScoreRegression {
  metric: keyof CorpusScore;
  baseline: number | null;
  current: number | null;
  delta: number;
  tolerance: number;
}

export function scoreFromDrift(
  drift: FixtureDrift,
  libreofficePages: number,
  sobreePages: number | null,
): CorpusScore {
  return {
    meanAbsDrift: drift.meanAbsDrift,
    libreofficePages,
    sobreePages,
    pageCountDelta:
      sobreePages === null ? null : Math.abs(sobreePages - libreofficePages),
    blockCount: drift.blockCount,
    matchedBlocks: drift.matchedBlocks,
    matchedBlockRatio:
      drift.blockCount > 0 ? drift.matchedBlocks / drift.blockCount : 1,
  };
}

/**
 * Compare a fresh score to a committed baseline. Returns an empty
 * array when within tolerance, otherwise one entry per metric that
 * regressed. Unset baselines (first-time runs) don't regress.
 */
export function compareToBaseline(
  current: CorpusScore,
  baseline: CorpusScore | null,
): ScoreRegression[] {
  if (!baseline) return [];
  const out: ScoreRegression[] = [];

  // meanAbsDrift: regression = current > baseline + tolerance
  if (current.meanAbsDrift !== null && baseline.meanAbsDrift !== null) {
    const delta = current.meanAbsDrift - baseline.meanAbsDrift;
    if (delta > SCORE_TOLERANCE.meanAbsDrift) {
      out.push({
        metric: "meanAbsDrift",
        baseline: baseline.meanAbsDrift,
        current: current.meanAbsDrift,
        delta,
        tolerance: SCORE_TOLERANCE.meanAbsDrift,
      });
    }
  }

  // pageCountDelta: regression = current > baseline (we want pages to
  // STAY matching; allowing pages to drift further is regression).
  if (current.pageCountDelta !== null && baseline.pageCountDelta !== null) {
    const delta = current.pageCountDelta - baseline.pageCountDelta;
    if (delta > SCORE_TOLERANCE.pageCountDelta) {
      out.push({
        metric: "pageCountDelta",
        baseline: baseline.pageCountDelta,
        current: current.pageCountDelta,
        delta,
        tolerance: SCORE_TOLERANCE.pageCountDelta,
      });
    }
  }

  // matchedBlockRatio: regression = current dropped below baseline by
  // more than the absolute floor (0.95 means we allow at most 5% of
  // blocks to be unmatched at baseline; further drops = regression).
  const ratioDrop = baseline.matchedBlockRatio - current.matchedBlockRatio;
  if (ratioDrop > 0.02) {
    out.push({
      metric: "matchedBlockRatio",
      baseline: baseline.matchedBlockRatio,
      current: current.matchedBlockRatio,
      delta: -ratioDrop,
      tolerance: 0.02,
    });
  }

  return out;
}
