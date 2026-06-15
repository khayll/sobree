/**
 * Line-by-line layout delta between Sobree and LibreOffice for a
 * single corpus entry's page 1. Tells you WHERE each visible line
 * lands relative to LibreOffice's PDF rendering.
 *
 * Output is suitable for screenshot-based convergence work: the
 * largest |deltaY| / |deltaX| values point at the layout differences
 * that matter, sorted so the biggest fix-target surfaces first.
 *
 * Inputs:
 *   - `loLines`: the parsed `libreoffice/metrics.json` for the page.
 *     Each line is `{ x, y, text, fontSize, ... }`. LibreOffice uses
 *     PDF coordinates: x = pt from LEFT of page, y = pt from BOTTOM.
 *   - `sobreeLines`: extracted from a live Sobree render via
 *     `extractSobreeLines()` (see browser-side helper). Same coord
 *     system as `loLines` (pt-from-bottom for y) so the diff math
 *     stays symmetric.
 *
 * Matching is text-similarity-based: for each LO line we find the
 * Sobree line with the highest similarity (substring-contained
 * preferred, then char-bag overlap). Threshold 0.7 → matched;
 * below → reported as "unmatched" with the best similarity score
 * so you can see how close we got.
 */

export interface PositionedLine {
  /** Pt from page LEFT edge. */
  xPt: number;
  /** Pt from page BOTTOM edge (PDF convention). */
  yPt: number;
  /** Whitespace-normalised text. */
  text: string;
}

export interface LineDelta {
  /** LO line text (truncated for display). */
  text: string;
  /** Sobree y minus LO y, in pt. Positive = Sobree HIGHER on page. */
  deltaY?: number;
  /** Sobree x minus LO x, in pt. Positive = Sobree FURTHER RIGHT. */
  deltaX?: number;
  /** Match similarity score (0..1) — useful when investigating
   *  whether a delta is real layout drift vs a wrong text match. */
  similarity?: number;
  /** Set when no Sobree line scored above the match threshold. */
  unmatched?: true;
  /** Best similarity found, even if below threshold. */
  bestSimilarity?: number;
}

/**
 * Compute per-line deltas. Returns the deltas in the LO line order so
 * the caller can read it top-to-bottom of the page.
 */
export function computeLayoutDelta(
  loLines: readonly PositionedLine[],
  sobreeLines: readonly PositionedLine[],
  matchThreshold = 0.7,
): LineDelta[] {
  const out: LineDelta[] = [];
  for (const lo of loLines) {
    let best: PositionedLine | null = null;
    let bestSim = 0;
    for (const so of sobreeLines) {
      const sim = textSimilarity(lo.text, so.text);
      if (sim > bestSim) {
        bestSim = sim;
        best = so;
      }
    }
    const textPreview = lo.text.slice(0, 60);
    if (best && bestSim >= matchThreshold) {
      out.push({
        text: textPreview,
        deltaY: Math.round(best.yPt - lo.yPt),
        deltaX: Math.round(best.xPt - lo.xPt),
        similarity: Number(bestSim.toFixed(2)),
      });
    } else {
      out.push({
        text: textPreview,
        unmatched: true,
        bestSimilarity: Number(bestSim.toFixed(2)),
      });
    }
  }
  return out;
}

/**
 * Aggregate stats over a set of deltas — useful for CI-style
 * regression gates ("median y-drift should not exceed 30pt").
 */
export function summariseDeltas(deltas: readonly LineDelta[]): {
  matched: number;
  unmatched: number;
  medianDeltaY: number;
  medianDeltaX: number;
  maxAbsDeltaY: number;
  maxAbsDeltaX: number;
} {
  const matched = deltas.filter((d) => !d.unmatched);
  const ys = matched.map((d) => d.deltaY!).sort((a, b) => a - b);
  const xs = matched.map((d) => d.deltaX!).sort((a, b) => a - b);
  const med = (arr: number[]) => (arr.length === 0 ? 0 : arr[Math.floor(arr.length / 2)]!);
  const maxAbs = (arr: number[]) =>
    arr.length === 0 ? 0 : arr.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  return {
    matched: matched.length,
    unmatched: deltas.length - matched.length,
    medianDeltaY: med(ys),
    medianDeltaX: med(xs),
    maxAbsDeltaY: maxAbs(ys),
    maxAbsDeltaX: maxAbs(xs),
  };
}

/**
 * Substring-aware text similarity in [0, 1]. Two equal strings → 1.
 * One contained in the other (and long enough to not be coincidental)
 * → contained-length ratio. Otherwise fall back to character-bag
 * overlap (close-but-not-identical lines still get a useful score so
 * we can match LO-extracted text against Sobree's slightly-different
 * whitespace).
 */
export function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const A = a.toLowerCase().replace(/\s+/g, " ").trim();
  const B = b.toLowerCase().replace(/\s+/g, " ").trim();
  if (A === B) return 1;
  const [shorter, longer] = A.length <= B.length ? [A, B] : [B, A];
  if (longer.includes(shorter) && shorter.length >= 8) {
    return shorter.length / longer.length;
  }
  let common = 0;
  const bag: Record<string, number> = {};
  for (const c of shorter) bag[c] = (bag[c] ?? 0) + 1;
  for (const c of longer) {
    if ((bag[c] ?? 0) > 0) {
      common++;
      bag[c]--;
    }
  }
  return common / Math.max(A.length, B.length);
}
