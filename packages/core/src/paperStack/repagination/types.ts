/**
 * The host interface the repagination orchestrator drives. Every method
 * is a DOM / page-state operation that stays on `PaperStack`; the
 * orchestrator (`run.ts`) owns only the retry algorithm and calls back
 * through this contract. Keeping the surface small and DOM-free here is
 * what lets the retry loop be unit-tested against a fake host.
 */
export interface RepaginationHost {
  /** Every block element currently distributed across all papers. */
  collectAllBlocks(): HTMLElement[];
  /** Create or remove papers so there are exactly `count` of them. */
  ensurePaperCount(count: number): void;
  /** The baseline per-page content height budget, in CSS px. */
  pageContentHeightPx(): number;
  /** Run ONE consolidate→merge→paginate→distribute pass at the given
   *  baseline budget and per-page height overrides. */
  runPaginationOnce(baselineBudgetPx: number, pageHeights: readonly number[]): void;
  /** Populate each paper's footnote zone from the refs that landed on it. */
  distributeFootnotes(): void;
  /** Per-page budgets after subtracting observed footnote-zone heights;
   *  trailing full-baseline entries trimmed (length 0 ⇒ no overrides). */
  footnotePageHeights(baselineBudgetPx: number): number[];
  /** The largest amount (px) any single paper currently overflows by. */
  maxPaperOverflowPx(): number;
  /** Re-render header/footer (and anchor) zones on every paper. */
  renderAllZones(): void;
  /** Apply per-section property overrides (e.g. vertical alignment). */
  applyPerSectionSettings(): void;
  /** Fire the `paginate` event to listeners. */
  emitPaginate(): void;
}
