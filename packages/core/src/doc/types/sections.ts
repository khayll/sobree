// Section page-setup geometry (page size, margins, columns, vAlign).

import type { HeaderFooterRef } from "./headersFooters";

export interface SectionProperties {
  pageSize: PageSize;
  pageMargins: PageMargins;
  /** Header references. Most docs have one or two. */
  headerRefs: HeaderFooterRef[];
  footerRefs: HeaderFooterRef[];
  /** Show the first-page header/footer slot if true. */
  titlePage?: boolean;
  /** Continuous, nextPage, etc. */
  type?: "continuous" | "nextPage" | "evenPage" | "oddPage";
  /**
   * Vertical alignment of the body content on each page in this section.
   * OOXML `<w:vAlign>` (ECMA-376 §17.6.21). Only visible on partial pages
   * — full pages have no slack to redistribute. Default is `"top"` (the
   * field is omitted in that case).
   *
   *   - `top`    — content anchored to top margin (default).
   *   - `center` — content centred between top and bottom margin.
   *   - `bottom` — content anchored to bottom margin.
   *   - `both`   — paragraph spacing stretched to fill the page.
   */
  vAlign?: "top" | "center" | "bottom" | "both";
  /**
   * Multi-column layout for the section's content (`<w:cols>`).
   * Absent or `count <= 1` → single column (the default; the renderer
   * does not wrap in a column container in that case).
   */
  columns?: SectionColumns;
}

export interface SectionColumns {
  /** Number of columns. */
  count: number;
  /** Default inter-column gap in twips (Word's `<w:cols w:space>`). Used
   *  for equal columns and as the fallback gap when a per-column space
   *  is absent. */
  spaceTwips?: number;
  /** `false` when the section declares explicit per-column widths
   *  (Word's `<w:cols w:equalWidth="0">`). Absent/`true` → equal columns,
   *  which the renderer flows with CSS multi-column. */
  equalWidth?: boolean;
  /** `<w:cols w:sep="1">` — draw a thin vertical rule between columns. */
  separator?: boolean;
  /** Per-column geometry from `<w:col w:w w:space>`, present only for the
   *  unequal case. `length === count`. Each entry's `spaceTwips` is the
   *  gap AFTER that column (the last column's is usually absent). The
   *  renderer flows blocks across these tracks at their true widths. */
  columns?: SectionColumn[];
}

export interface SectionColumn {
  /** Column width in twips (`<w:col w:w>`). */
  widthTwips: number;
  /** Trailing gap after this column in twips (`<w:col w:space>`). */
  spaceTwips?: number;
}

export interface PageSize {
  wTwips: number;
  hTwips: number;
  orientation: "portrait" | "landscape";
}

export interface PageMargins {
  topTwips: number;
  rightTwips: number;
  bottomTwips: number;
  leftTwips: number;
  headerTwips: number;
  footerTwips: number;
  gutterTwips: number;
}
