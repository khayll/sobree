/** A single line or image-like unit. Contributes height. */
export interface Box {
  type: "box";
  height: number;
  /** Identifier shared by all lines of the same paragraph. */
  paragraphId?: string;
  isFirstLineOfParagraph?: boolean;
  isLastLineOfParagraph?: boolean;
  /** If true, the box is never split across a page break. */
  monolithic?: boolean;
  /** Paragraph-level: this paragraph must stay adjacent to the next. */
  keepWithNext?: boolean;
  /** Paragraph-level: all lines of this paragraph must fit on one page. */
  keepTogether?: boolean;
}

/** Whitespace. Discarded at page edges when it ends up there. */
export interface Glue {
  type: "glue";
  height: number;
}

/**
 * A break point annotation with a finite cost, or a forced break
 * (-Infinity), or a forbidden break (+Infinity).
 */
export interface Penalty {
  type: "penalty";
  cost: number;
}

export type Item = Box | Glue | Penalty;

export interface Config {
  /** Default page height in px. Used for any page index not covered
   *  by `pageHeights`. */
  pageHeight: number;
  /**
   * Per-page height overrides. Entry `i` is the budget for page index
   * `i`; missing/undefined entries fall back to `pageHeight`. Lets
   * callers shrink the body budget on specific pages (e.g. pages with
   * footnote zones eating space at the bottom) without penalising
   * pages that don't need it.
   */
  pageHeights?: readonly number[];
  /** Minimum lines of a paragraph on the new page. Default 2. */
  widows?: number;
  /** Minimum lines of a paragraph on the current page. Default 2. */
  orphans?: number;
  /** Multiplier for underfull penalty (leftover²). Default 1.0. */
  underfullWeight?: number;
  /** Added when a candidate break would leave a widow or orphan. Default 10000. */
  widowOrphanPenalty?: number;
  /** Added to breaks inside keepTogether ranges; used for keep-with-next. Default 10000. */
  keepPenalty?: number;
}

export interface ResolvedConfig {
  pageHeight: number;
  pageHeights?: readonly number[];
  widows: number;
  orphans: number;
  underfullWeight: number;
  widowOrphanPenalty: number;
  keepPenalty: number;
}

export interface Page {
  items: Item[];
  /** Total box + glue height, excluding trailing glue. */
  usedHeight: number;
  /** Cost of the chosen break ending this page; 0 for forced / end-of-stream. */
  cost: number;
}

/**
 * Candidate break position.
 *
 * `pageEnd` is the exclusive upper bound of the current page's items — on a
 * glue break the glue is INCLUDED (trailing glue stays on the current page
 * for round-tripping), so pageEnd = glueIdx + 1. On a penalty break the
 * penalty is EXCLUDED (consumed), so pageEnd = penaltyIdx.
 *
 * `nextStart` is the first item of the next page. On a penalty break it is
 * penaltyIdx + 1 (the penalty is consumed). On a glue break it equals
 * pageEnd.
 *
 * `heightAt` is the accumulated page height just *before* the candidate item
 * — glue is not counted against the page's useful height.
 */
export interface Candidate {
  pageEnd: number;
  nextStart: number;
  heightAt: number;
  ownCost: number;
}

export const DEFAULTS: Omit<ResolvedConfig, "pageHeight"> = {
  // Word's "Widow/Orphan Control" (`<w:widowControl/>`, ECMA-376
  // §17.3.1.44) is ON by default and PREVENTS single lines: a paragraph
  // straddling a page boundary must keep at least 2 lines on each side.
  // The previous 1/1 default had this backwards ("Word allows a single
  // line") — it let the scorer strand one orphan line under a heading at
  // a page bottom, a break Word never produces (acm-submission-template
  // kept the Introduction heading + one intro line on page 1 where Word
  // moves both to page 2). Paragraphs that explicitly DISABLE
  // widowControl (`w:val="0"`, e.g. ACM's Bibentry) may split 1-line in
  // Word — honouring that per-paragraph is a follow-up; default-on is by
  // far the common case.
  widows: 2,
  orphans: 2,
  underfullWeight: 1.0,
  widowOrphanPenalty: 10000,
  keepPenalty: 10000,
};

export function resolveConfig(cfg: Config): ResolvedConfig {
  return {
    pageHeight: cfg.pageHeight,
    ...(cfg.pageHeights ? { pageHeights: cfg.pageHeights } : {}),
    widows: cfg.widows ?? DEFAULTS.widows,
    orphans: cfg.orphans ?? DEFAULTS.orphans,
    underfullWeight: cfg.underfullWeight ?? DEFAULTS.underfullWeight,
    widowOrphanPenalty: cfg.widowOrphanPenalty ?? DEFAULTS.widowOrphanPenalty,
    keepPenalty: cfg.keepPenalty ?? DEFAULTS.keepPenalty,
  };
}

/** Effective page budget for `pageIdx` — per-page override if present,
 *  global `pageHeight` otherwise. */
export function pageHeightAt(cfg: ResolvedConfig, pageIdx: number): number {
  return cfg.pageHeights?.[pageIdx] ?? cfg.pageHeight;
}
