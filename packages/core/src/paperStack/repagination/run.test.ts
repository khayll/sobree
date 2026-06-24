import { describe, expect, it } from "vitest";
import { MAX_REPAGINATE_RETRIES, OVERFLOW_TOLERANCE_PX, repaginate } from "./run";
import type { RepaginationHost } from "./types";

/**
 * A fake {@link RepaginationHost} that records the order of calls and lets
 * each test script the two signals the convergence check reads:
 * `footnotePageHeights` and `maxPaperOverflowPx`. No DOM — the point of the
 * host seam is that the retry loop can be exercised in isolation.
 */
function makeHost(opts: {
  blockCount?: number;
  /** Per-iteration footnote heights returned (defaults to [] each call). */
  heightsByAttempt?: number[][];
  /** Per-iteration overflow returned (defaults to 0 each call). */
  overflowByAttempt?: number[];
}) {
  const log: string[] = [];
  const runBudgets: Array<readonly number[]> = [];
  const footnoteBudgets: number[] = [];
  let attempt = 0;
  const host: RepaginationHost = {
    collectAllBlocks: () => {
      log.push("collectAllBlocks");
      return Array.from({ length: opts.blockCount ?? 1 }, () => document.createElement("p"));
    },
    ensurePaperCount: (n) => log.push(`ensurePaperCount(${n})`),
    // Orthogonal to the retry-loop sequence under test — kept out of `log`.
    captureSelection: () => null,
    restoreSelection: () => {},
    pageContentHeightPx: () => {
      log.push("pageContentHeightPx");
      return 1000;
    },
    runPaginationOnce: (_budget, pageHeights) => {
      log.push("runPaginationOnce");
      runBudgets.push(pageHeights);
    },
    distributeFootnotes: () => log.push("distributeFootnotes"),
    footnotePageHeights: (budget) => {
      log.push("footnotePageHeights");
      footnoteBudgets.push(budget);
      const heights = opts.heightsByAttempt?.[attempt] ?? [];
      attempt++;
      return heights;
    },
    maxPaperOverflowPx: () => {
      log.push("maxPaperOverflowPx");
      return opts.overflowByAttempt?.[attempt - 1] ?? 0;
    },
    renderAllZones: () => log.push("renderAllZones"),
    applyPerSectionSettings: () => log.push("applyPerSectionSettings"),
    emitPaginate: () => log.push("emitPaginate"),
  };
  return { host, log, runBudgets, footnoteBudgets };
}

describe("repaginate — empty document fast path", () => {
  it("ensures one paper, renders zones, emits — and skips the loop", () => {
    const { host, log } = makeHost({ blockCount: 0 });
    repaginate(host);
    expect(log).toEqual([
      "collectAllBlocks",
      "ensurePaperCount(1)",
      "renderAllZones",
      "emitPaginate",
    ]);
    expect(log).not.toContain("runPaginationOnce");
    expect(log).not.toContain("applyPerSectionSettings");
  });
});

describe("repaginate — convergence in one pass", () => {
  it("runs a single pagination pass when budgets are stable and no overflow", () => {
    // First footnotePageHeights returns [] which equals the initial [],
    // so `stable` is true on attempt 0; overflow 0 ≤ tolerance ⇒ break.
    const { host, log } = makeHost({ heightsByAttempt: [[]], overflowByAttempt: [0] });
    repaginate(host);
    expect(log).toEqual([
      "collectAllBlocks",
      "pageContentHeightPx",
      "runPaginationOnce",
      "distributeFootnotes",
      "footnotePageHeights",
      "maxPaperOverflowPx",
      "renderAllZones",
      "applyPerSectionSettings",
      "emitPaginate",
    ]);
  });
});

describe("repaginate — footnote budget feedback drives a retry", () => {
  it("feeds the previous pass's footnote heights into the next pagination", () => {
    // Attempt 0: heights change ([] → [900]) ⇒ not stable ⇒ retry.
    // Attempt 1: heights stable ([900] → [900]) ⇒ break.
    const { host, runBudgets, footnoteBudgets } = makeHost({
      heightsByAttempt: [[900], [900]],
      overflowByAttempt: [0, 0],
    });
    repaginate(host);
    // Two pagination passes: first with the initial empty budget, second
    // with the heights observed after the first footnote distribution.
    expect(runBudgets).toEqual([[], [900]]);
    // footnotePageHeights always receives the baseline budget.
    expect(footnoteBudgets).toEqual([1000, 1000]);
  });
});

describe("repaginate — overflow keeps it iterating to the cap", () => {
  it("stops after MAX_REPAGINATE_RETRIES+1 passes when never converging", () => {
    // Stable heights but persistent overflow above tolerance: the loop
    // never satisfies the break condition and runs the full bound.
    const big = OVERFLOW_TOLERANCE_PX + 50;
    const { host, log } = makeHost({
      heightsByAttempt: Array.from({ length: 6 }, () => []),
      overflowByAttempt: Array.from({ length: 6 }, () => big),
    });
    repaginate(host);
    const passes = log.filter((l) => l === "runPaginationOnce").length;
    expect(passes).toBe(MAX_REPAGINATE_RETRIES + 1);
    // Still finalises after giving up.
    expect(log.slice(-3)).toEqual(["renderAllZones", "applyPerSectionSettings", "emitPaginate"]);
  });
});
