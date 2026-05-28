/**
 * Shared types for the PDF metrics pipeline.
 *
 * `LineMetric` is the unit Sobree's rendering oracle compares against:
 * one entry per visual line in a LibreOffice-rendered PDF, carrying
 * point-precise position + size.
 */

export interface LineMetric {
  /** Concatenated text content of all text items on this visual line. */
  text: string;
  /** PDF user-space x of the leftmost text item (PDF origin = bottom-left). */
  x: number;
  /** PDF user-space y of the line baseline. Larger y = higher on page. */
  y: number;
  /** Visual width — `(max right edge) − x` across all items on the line. */
  width: number;
  /** Tallest item's reported height (proxy for line height in pt). */
  height: number;
  /** Font name as reported by pdfjs (`Cambria-Bold`, `Times-Roman`, …). */
  fontName: string;
  /** Font size in pt, derived from the transform's d component. */
  fontSize: number;
}

export interface FixtureMetrics {
  /** The source `.docx` filename. */
  fixture: string;
  /** Page size in pt (1pt = 1/72in). A4 is ~595 × 842. */
  pdfSizePt: { width: number; height: number };
  pages: Array<{ page: number; lines: LineMetric[] }>;
}
