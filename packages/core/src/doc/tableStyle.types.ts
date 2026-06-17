/**
 * The table-style conditional-formatting model — Sobree's representation
 * of a `<w:style w:type="table">`.
 *
 * A cohesive, dependency-light concern: it describes how a table style
 * paints its cells (whole-table base + per-region conditional formats),
 * resolved per cell at render time (`doc/tableStyle.ts`). Depends only on
 * the formatting primitives, never on the recursive `Block` graph, so it
 * stays out of `types.ts`. Re-exported from `./types`, so consumers keep
 * importing every AST type from there.
 */

import type { Shading, TableBorders, TableCellBorders, TableCellMargins } from "./formatting.types";

/** `<w:tblLook>` flags. A flag absent ⇒ that conditional format is OFF. */
export interface TableLook {
  firstRow?: boolean;
  lastRow?: boolean;
  firstColumn?: boolean;
  lastColumn?: boolean;
  /** Row (horizontal) banding active. */
  hBand?: boolean;
  /** Column (vertical) banding active. */
  vBand?: boolean;
}

/**
 * A table style's conditional-format regions (`<w:tblStylePr w:type>`).
 * Each names a slice of the table whose cells get extra formatting when
 * the table's `<w:tblLook>` enables it. Resolution precedence (low→high,
 * ECMA-376 §17.7.6): wholeTable → vBands → hBands → first/last column →
 * first/last row → corner cells, then direct cell formatting wins.
 */
export type TableConditionalType =
  | "firstRow"
  | "lastRow"
  | "firstCol"
  | "lastCol"
  | "band1Horz"
  | "band2Horz"
  | "band1Vert"
  | "band2Vert"
  | "nwCell"
  | "neCell"
  | "swCell"
  | "seCell";

/** The formatting one region (or the whole-table base) contributes. */
export interface TableStyleCellFormat {
  shading?: Shading;
  borders?: TableCellBorders;
}

/**
 * A `<w:style w:type="table">` definition: whole-table base formatting +
 * per-region conditional formatting + band sizes. Resolved per cell at
 * render time against the table's `look`.
 */
export interface TableStyleDefinition {
  /** Whole-table borders (`<w:tblBorders>` — incl. `insideH`/`insideV`). */
  borders?: TableBorders;
  /** Whole-table base cell shading. */
  shading?: Shading;
  /** Rows per horizontal band (`<w:tblStyleRowBandSize>`, default 1). */
  rowBandSize?: number;
  /** Columns per vertical band (`<w:tblStyleColBandSize>`, default 1). */
  colBandSize?: number;
  /** Whole-table default cell padding (`<w:tblCellMar>` in the style). */
  cellMargins?: TableCellMargins;
  conditional?: Partial<Record<TableConditionalType, TableStyleCellFormat>>;
}
