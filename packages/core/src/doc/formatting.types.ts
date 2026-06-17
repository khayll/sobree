/**
 * Formatting value-types: borders, shading, and table-style conditional
 * formatting.
 *
 * Split out from `types.ts` (the core AST module) as a dependency-free
 * LEAF — none of these reference the recursive `Block` document graph, so
 * they import nothing from `types.ts`. Keeping them here avoids a circular
 * dependency: `types.ts` imports + re-exports them, so consumers still get
 * every AST type from `./types`.
 */

export interface BorderSpec {
  style: "single" | "double" | "dashed" | "dotted" | "thick" | "none";
  /** Eighths of a point (Word's `w:sz`). */
  sizeEighthsOfPt: number;
  /** `#rrggbb` or `auto`. */
  color: string;
  /** Twips of clear space between border and text. */
  spaceTwips?: number;
}

export interface Shading {
  /** Pattern (`clear`, `pct10`, `solid`, …). Most highlights are `clear`. */
  pattern: string;
  /** Background `#rrggbb` or `auto`. */
  fill: string;
  /** Pattern foreground `#rrggbb` or `auto`. */
  color?: string;
}

export interface TableBorders {
  top?: BorderSpec;
  right?: BorderSpec;
  bottom?: BorderSpec;
  left?: BorderSpec;
  insideH?: BorderSpec;
  insideV?: BorderSpec;
}

export interface TableCellBorders {
  top?: BorderSpec;
  right?: BorderSpec;
  bottom?: BorderSpec;
  left?: BorderSpec;
}

/** Default cell padding (`<w:tblCellMar>` / `<w:tcMar>`), in twips. An
 *  absent side falls back to the renderer's Word default. */
export interface TableCellMargins {
  topTwips?: number;
  rightTwips?: number;
  bottomTwips?: number;
  leftTwips?: number;
}

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
