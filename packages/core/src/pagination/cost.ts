import type { Box, Candidate, Item, ResolvedConfig } from "./types";

/**
 * Score a candidate break. Lower is better.
 *
 *   totalCost = underfullWeight * leftover²
 *             + own penalty cost
 *             + widow/orphan penalty
 *             + keep-with-next penalty
 *             + keep-together penalty
 *
 * `start` is the index of the first item on the current page — needed so we
 * only count paragraph lines that live on this page (not on earlier ones).
 */
export function scoreBreak(
  items: Item[],
  start: number,
  c: Candidate,
  cfg: ResolvedConfig,
): number {
  const leftover = cfg.pageHeight - c.heightAt;
  const underfull = cfg.underfullWeight * leftover * leftover;
  return (
    underfull +
    c.ownCost +
    widowOrphanPenalty(items, start, c, cfg) +
    keepWithNextPenalty(items, c) +
    keepTogetherPenalty(items, c, cfg)
  );
}

/** Penalty for breaking inside a paragraph and leaving a widow or orphan. */
export function widowOrphanPenalty(
  items: Item[],
  start: number,
  c: Candidate,
  cfg: ResolvedConfig,
): number {
  const before = nearestBoxBefore(items, c.pageEnd);
  const after = nearestBoxAfter(items, c.nextStart);
  if (!before || !after) return 0;
  if (!before.paragraphId || before.paragraphId !== after.paragraphId) return 0;

  const pid = before.paragraphId;
  const linesAbove = countParagraphLinesOnPageBefore(items, start, c.pageEnd, pid);
  const linesBelow = countParagraphLinesOnNextPage(items, c.nextStart, pid);
  if (linesAbove < cfg.orphans || linesBelow < cfg.widows) return cfg.widowOrphanPenalty;
  return 0;
}

/**
 * +Infinity if the break is between a keepWithNext paragraph and whatever
 * follows. The only case we *don't* forbid is when the break is between two
 * lines of the same paragraph (widow/orphan's concern, not keep-with-next's).
 */
export function keepWithNextPenalty(items: Item[], c: Candidate): number {
  const before = nearestBoxBefore(items, c.pageEnd);
  const after = nearestBoxAfter(items, c.nextStart);
  if (!before || !after) return 0;
  if (!before.keepWithNext) return 0;
  // Same-paragraph break (both sides share a non-empty paragraphId) is an
  // internal line break — keep-with-next doesn't apply.
  if (before.paragraphId && before.paragraphId === after.paragraphId) return 0;
  return Number.POSITIVE_INFINITY;
}

/** Penalty for breaking inside a keepTogether paragraph. */
export function keepTogetherPenalty(items: Item[], c: Candidate, cfg: ResolvedConfig): number {
  const before = nearestBoxBefore(items, c.pageEnd);
  const after = nearestBoxAfter(items, c.nextStart);
  if (!before || !after) return 0;
  if (before.paragraphId && before.paragraphId === after.paragraphId && before.keepTogether) {
    return cfg.keepPenalty;
  }
  return 0;
}

// ---------- stream queries ----------

export function nearestBoxBefore(items: Item[], idxExclusive: number): Box | null {
  for (let i = idxExclusive - 1; i >= 0; i--) {
    const it = items[i];
    if (it && it.type === "box") return it;
  }
  return null;
}

export function nearestBoxAfter(items: Item[], idxInclusive: number): Box | null {
  for (let i = idxInclusive; i < items.length; i++) {
    const it = items[i];
    if (it && it.type === "box") return it;
  }
  return null;
}

export function countParagraphLinesOnPageBefore(
  items: Item[],
  start: number,
  pageEnd: number,
  pid: string,
): number {
  let count = 0;
  for (let i = pageEnd - 1; i >= start; i--) {
    const it = items[i];
    if (!it) continue;
    if (it.type !== "box") continue;
    if (it.paragraphId === pid) count++;
    else break;
  }
  return count;
}

export function countParagraphLinesOnNextPage(
  items: Item[],
  nextStart: number,
  pid: string,
): number {
  let count = 0;
  for (let i = nextStart; i < items.length; i++) {
    const it = items[i];
    if (!it) continue;
    if (it.type !== "box") continue;
    if (it.paragraphId === pid) count++;
    else break;
  }
  return count;
}

/** Sum of box + inter-line glue heights for the paragraph beginning at startIdx. */
export function sumParagraphHeight(items: Item[], startIdx: number): number {
  const first = items[startIdx];
  if (!first || first.type !== "box" || !first.paragraphId) {
    return first && "height" in first ? first.height : 0;
  }
  const pid = first.paragraphId;
  let h = 0;
  let i = startIdx;
  while (i < items.length) {
    const it = items[i];
    if (!it) break;
    if (it.type === "box") {
      if (it.paragraphId === pid) {
        h += it.height;
        i++;
      } else break;
    } else if (it.type === "glue") {
      const next = nearestBoxAfter(items, i + 1);
      if (next && next.paragraphId === pid) {
        h += it.height;
        i++;
      } else break;
    } else {
      i++; // penalty, no height
    }
  }
  return h;
}

export function isGlueBetweenBoxes(items: Item[], idx: number): boolean {
  const before = nearestBoxBefore(items, idx);
  const after = nearestBoxAfter(items, idx + 1);
  return Boolean(before && after);
}

export function isGlueInsideKeepTogether(items: Item[], idx: number): boolean {
  const before = nearestBoxBefore(items, idx);
  const after = nearestBoxAfter(items, idx + 1);
  if (!before || !after) return false;
  if (!before.paragraphId || before.paragraphId !== after.paragraphId) return false;
  return Boolean(before.keepTogether);
}
