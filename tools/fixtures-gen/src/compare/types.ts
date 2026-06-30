/**
 * Types for the LibreOffice-vs-Sobree drift report.
 *
 * A drift report answers one question per paragraph block:
 *   "What line-height does Sobree declare in its rendered style, and
 *    what line-height does LibreOffice actually produce for the same
 *    text?"
 *
 * The unit of comparison is the Sobree "block" (one entry in the
 * `.snapshot.json` `blocks` array). We match each block to one or
 * more consecutive `LineMetric`s from the `.libreoffice.json` by text
 * prefix, then compare the declared CSS line-height against the
 * effective `Δy / fontSize` LibreOffice measured.
 */

export interface BlockDrift {
  /** Index of the block in the snapshot's `blocks` array. */
  index: number;
  /** Block tag (P, H1, OL, TABLE, …) — for display in reports. */
  tag: string;
  /** Truncated text from the snapshot (matches whatever the snapshot stored). */
  text: string;
  /** Sobree's declared CSS `font-size` (pt), parsed from inline style. */
  declaredFontSizePt: number | null;
  /** Sobree's declared CSS `line-height` (unitless multiplier or "normal"). */
  declaredLineHeight: number | "normal" | null;
  /** Number of consecutive PDF lines matched to this block. */
  matchedLineCount: number;
  /** Median Δy between consecutive matched PDF lines (pt). Null if <2 lines. */
  pdfDeltaY: number | null;
  /**
   * Effective line-height = pdfDeltaY / declaredFontSizePt. Null when
   * either component is missing.
   */
  pdfEffectiveLineHeight: number | null;
  /** declaredLineHeight − pdfEffectiveLineHeight (pt-multiplier). */
  lineHeightDrift: number | null;
  /** First matched PDF line's text — for debugging mis-matches. */
  pdfFirstLineText: string | null;
}

export interface FixtureDrift {
  fixture: string;
  /** Total blocks in the snapshot. */
  blockCount: number;
  /** Blocks carrying real document text (non-empty, non-chrome) — the
   *  fair denominator for the matched ratio. Empty spacer paragraphs and
   *  section-break separators can never match a PDF line, so counting
   *  them would penalise a faithfully-rendered doc. */
  textBlockCount: number;
  /** Blocks that successfully matched at least one PDF line. */
  matchedBlocks: number;
  /** Blocks with >= 2 matched lines (where we can compute effective leading). */
  multiLineBlocks: number;
  /** Mean of |lineHeightDrift| across `multiLineBlocks` (excludes nulls). */
  meanAbsDrift: number | null;
  /** Per-block details. */
  blocks: BlockDrift[];
  /** Warnings encountered (e.g. unmatched block text, missing styles). */
  warnings: string[];
}
