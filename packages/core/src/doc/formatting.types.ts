/**
 * Visual formatting primitives: borders, shading, and cell spacing.
 *
 * Low-level value-types shared across the AST — paragraphs, runs, and
 * tables all paint with these. A dependency-free LEAF: none reference the
 * recursive `Block` document graph, so keeping them here (out of
 * `types.ts`) avoids a circular dependency. `types.ts` imports +
 * re-exports them, so consumers still get every AST type from `./types`.
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

/** A table's outer edges plus the inside-horizontal / inside-vertical
 *  separators (`<w:tblBorders>`). */
export interface TableBorders {
  top?: BorderSpec;
  right?: BorderSpec;
  bottom?: BorderSpec;
  left?: BorderSpec;
  insideH?: BorderSpec;
  insideV?: BorderSpec;
}

/** A single cell's four edges (`<w:tcBorders>`). */
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
