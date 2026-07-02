import {
  isGlueBetweenBoxes,
  isGlueInsideKeepTogether,
  scoreBreak,
  sumParagraphHeight,
} from "./cost";
import { backOffIfViolates } from "./postConditions";
import {
  type Candidate,
  type Config,
  type Item,
  type Page,
  type ResolvedConfig,
  pageHeightAt,
  resolveConfig,
} from "./types";

/**
 * Greedy one-pass paginator. See README.md for the full cost model.
 *
 *   Walk the item stream, accumulating page height and a list of candidate
 *   break positions. When the next item overflows — or a forced penalty
 *   appears — pick the candidate that minimises totalCost (see scoreBreak),
 *   emit the page, and continue from the chosen break.
 */
export function paginate(items: Item[], config: Config): Page[] {
  const cfg = resolveConfig(config);
  const pages: Page[] = [];
  let start = 0;
  while (start < items.length) {
    // Each page sees its own `pageHeight` — either the per-page
    // override from `cfg.pageHeights[pageIdx]` or the global default.
    // We pass a one-shot resolved config to fillPage rather than
    // threading a page-index parameter through every helper.
    const pageCfg: ResolvedConfig = { ...cfg, pageHeight: pageHeightAt(cfg, pages.length) };
    const result = fillPage(items, start, pageCfg);
    pages.push(result.page);
    if (result.next <= start) break; // paranoia — should never happen
    start = result.next;
  }
  return pages;
}

interface FillResult {
  page: Page;
  next: number;
}

function fillPage(items: Item[], start: number, cfg: ResolvedConfig): FillResult {
  let h = 0;
  const candidates: Candidate[] = [];
  let idx = start;
  // Has at least one BOX been placed on this page? A page may open with
  // GLUE (a forced break precedes the inter-block gap so the new page is
  // charged the space-before Word honours after hard breaks) — breaking
  // before any box is placed would emit an empty page, so every overflow
  // guard below requires `hasBox`, not merely `idx > start`.
  let hasBox = false;

  while (idx < items.length) {
    const it = items[idx];
    if (!it) break;

    if (it.type === "penalty") {
      if (it.cost === Number.NEGATIVE_INFINITY) {
        // Forced break: current page ends before this penalty; the penalty
        // itself is consumed and doesn't appear on either page.
        return emit(items, start, idx, 0, idx + 1);
      }
      if (Number.isFinite(it.cost)) {
        candidates.push({ pageEnd: idx, nextStart: idx + 1, heightAt: h, ownCost: it.cost });
      }
      // +Infinity penalties are never candidates and don't contribute height.
      idx++;
      continue;
    }

    if (it.type === "glue") {
      // `h > 0`: a page can BEGIN with glue (a forced break precedes the
      // gap so the new page is charged the space-before Word honours
      // after hard breaks) — breaking at that leading glue would emit an
      // EMPTY page, never a sensible candidate.
      if (h > 0 && isGlueBetweenBoxes(items, idx) && !isGlueInsideKeepTogether(items, idx)) {
        // Glue break: glue STAYS on current page as trailing — so pageEnd
        // is one past the glue. heightAt excludes the glue's height so
        // leftover reflects usable page space, not trailing whitespace.
        candidates.push({
          pageEnd: idx + 1,
          nextStart: idx + 1,
          heightAt: h,
          ownCost: 0,
        });
      }
      if (h + it.height > cfg.pageHeight) {
        return pickAndEmit(items, start, idx, candidates, cfg);
      }
      h += it.height;
      idx++;
      continue;
    }

    // box
    const box = it;

    // Oversized monolithic item with room used: force a break before it.
    if (box.monolithic && h + box.height > cfg.pageHeight && hasBox) {
      return pickAndEmit(items, start, idx, candidates, cfg);
    }

    // Oversized item on an otherwise empty page: place alone and let it overflow.
    if (box.height > cfg.pageHeight && !hasBox) {
      // eslint-disable-next-line no-console
      console.warn(
        `paginate: item (height ${box.height}) exceeds pageHeight (${cfg.pageHeight}). Placing alone; page will overflow.`,
      );
      return {
        page: { items: [box], usedHeight: h + box.height, cost: 0 },
        next: idx + 1,
      };
    }

    // keepTogether: if the whole paragraph can't fit in remaining space,
    // break before it (so it starts fresh on the next page). If it can't
    // fit on a full page at all, warn and fall through.
    if (box.isFirstLineOfParagraph && box.keepTogether) {
      const paraH = sumParagraphHeight(items, idx);
      if (paraH > cfg.pageHeight) {
        // eslint-disable-next-line no-console
        console.warn(
          `paginate: keepTogether paragraph (height ${paraH}) exceeds pageHeight (${cfg.pageHeight}). Falling back to normal breaking.`,
        );
        // fall through
      } else if (h + paraH > cfg.pageHeight && hasBox) {
        return pickAndEmit(items, start, idx, candidates, cfg);
      }
    }

    // Generic overflow: adding this box would exceed page height. Requires
    // hasBox — with only leading glue placed, breaking would emit an empty
    // page; instead the box is placed (it may overflow slightly, matching
    // Word drawing a hard-break paragraph's space-before regardless).
    if (h + box.height > cfg.pageHeight && hasBox) {
      return pickAndEmit(items, start, idx, candidates, cfg);
    }

    h += box.height;
    hasBox = true;
    idx++;
  }

  // End of stream.
  return emit(items, start, items.length, 0, items.length);
}

function pickAndEmit(
  items: Item[],
  start: number,
  overflowIdx: number,
  candidates: Candidate[],
  cfg: ResolvedConfig,
): FillResult {
  if (candidates.length === 0) {
    // No candidates: force break at overflow position.
    return emit(items, start, overflowIdx, 0, overflowIdx);
  }

  // Score and pick best.
  let best: Candidate = candidates[0] as Candidate;
  let bestCost = scoreBreak(items, start, best, cfg);
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c) continue;
    const cost = scoreBreak(items, start, c, cfg);
    if (cost < bestCost) {
      best = c;
      bestCost = cost;
    }
  }

  // Post-condition: back off by one line if widow/orphan still violated.
  const adjusted = backOffIfViolates(items, start, best, candidates, cfg);
  const adjustedCost = adjusted === best ? bestCost : scoreBreak(items, start, adjusted, cfg);

  return emit(items, start, adjusted.pageEnd, adjustedCost, adjusted.nextStart);
}

function emit(
  items: Item[],
  start: number,
  endExclusive: number,
  cost: number,
  next: number,
): FillResult {
  const pageItems = items.slice(start, endExclusive);
  return {
    page: {
      items: pageItems,
      usedHeight: computeUsedHeight(pageItems),
      cost,
    },
    next,
  };
}

/**
 * Total height of a page: sum of box + glue heights, but drop trailing glue
 * (glue items after the last box on the page). Penalties never contribute.
 */
function computeUsedHeight(pageItems: Item[]): number {
  let lastBoxIdx = -1;
  for (let i = pageItems.length - 1; i >= 0; i--) {
    if (pageItems[i]?.type === "box") {
      lastBoxIdx = i;
      break;
    }
  }
  if (lastBoxIdx < 0) return 0;
  let h = 0;
  for (let i = 0; i <= lastBoxIdx; i++) {
    const it = pageItems[i];
    if (!it) continue;
    if (it.type === "box" || it.type === "glue") h += it.height;
  }
  return h;
}
