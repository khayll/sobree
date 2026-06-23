// Table blocks: grid, rows, cells, and table-level properties.

import type {
  Shading,
  TableBorders,
  TableCellBorders,
  TableCellMargins,
} from "../formatting.types";
import type { TableLook, TableStyleDefinition } from "../tableStyle.types";
import type { Block } from "./block";
import type { ParagraphAlignment } from "./paragraph";

export interface Table {
  kind: "table";
  /** Column widths in twips. Length = number of columns. */
  grid: number[];
  rows: TableRow[];
  properties: TableProperties;
}

export interface TableProperties {
  /** Total table width in twips, or "auto" for content-driven. */
  widthTwips?: number;
  alignment?: ParagraphAlignment;
  borders?: TableBorders;
  /** Style reference (e.g. "TableGrid"). */
  styleId?: string;
  /** `<w:tblLook>` — which of the table style's conditional formats are
   *  active (first row / column, last row / column, row / column
   *  banding). Gates {@link TableStyleDefinition} resolution. */
  look?: TableLook;
  /** `<w:tblCellMar>` — default inner padding for every cell (the table's
   *  own value wins over the style's). Word's stock default is ~108 twips
   *  left / right and 0 top / bottom when omitted. */
  cellMargins?: TableCellMargins;
}

export interface TableRow {
  cells: TableCell[];
  /** True if this row is a header row repeated on each page. */
  isHeader?: boolean;
}

export interface TableCell {
  /** Number of grid columns this cell spans horizontally. */
  gridSpan?: number;
  /** Vertical merge state — `restart` begins a merge, `continue` continues. */
  vMerge?: "restart" | "continue";
  verticalAlign?: "top" | "center" | "bottom";
  shading?: Shading;
  borders?: TableCellBorders;
  /** Cell content — paragraphs and (rare) nested tables. */
  content: Block[];
}
