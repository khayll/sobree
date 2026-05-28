import { widowOrphanPenalty } from "./cost";
import type { Candidate, Item, ResolvedConfig } from "./types";

/**
 * If the chosen break still violates widow/orphan (despite the penalty in
 * scoring), walk the candidate list backward and pick the nearest earlier
 * candidate that doesn't violate — "back off the break by one line" in the
 * spec — effectively one paragraph line moves to the next page.
 *
 * Returns the original `best` if no earlier candidate avoids the violation.
 */
export function backOffIfViolates(
  items: Item[],
  start: number,
  best: Candidate,
  candidates: Candidate[],
  cfg: ResolvedConfig,
): Candidate {
  if (widowOrphanPenalty(items, start, best, cfg) === 0) return best;

  const bestPos = candidates.indexOf(best);
  for (let i = bestPos - 1; i >= 0; i--) {
    const c = candidates[i];
    if (!c) continue;
    if (widowOrphanPenalty(items, start, c, cfg) === 0) return c;
  }
  return best;
}
