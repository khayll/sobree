/**
 * Table builders — table, row, and cell. Composable: `table(rows)` takes
 * `tableRow(cells)` takes `tableCell(content)`, mirroring the AST nesting.
 */

import type { Block, Table, TableCell, TableProperties, TableRow } from "../types";
import { paragraph } from "./block";

/** Default total table width (twips) used to derive equal column widths
 *  when the caller doesn't supply an explicit `grid`. ~6.5" content area. */
const DEFAULT_TABLE_WIDTH_TWIPS = 9360;

/** A cell's properties — everything on {@link TableCell} except `content`
 *  (which is the positional argument). */
export type CellProperties = Partial<Omit<TableCell, "content">>;

/** A table cell. `content` defaults to a single empty paragraph (Word
 *  requires every cell to hold at least one paragraph). */
export function tableCell(
  content: Block[] = [paragraph()],
  properties: CellProperties = {},
): TableCell {
  return { ...properties, content };
}

/** A table row. */
export function tableRow(cells: TableCell[], opts: { isHeader?: boolean } = {}): TableRow {
  return { cells, ...(opts.isHeader ? { isHeader: true } : {}) };
}

export interface TableOptions {
  /** Column widths in twips (length = column count). Derived as equal
   *  columns from {@link DEFAULT_TABLE_WIDTH_TWIPS} when omitted. */
  grid?: number[];
  properties?: TableProperties;
}

/** A table. The column `grid` is taken from `opts.grid`, else derived as
 *  equal-width columns from the widest row's column count. */
export function table(rows: TableRow[], opts: TableOptions = {}): Table {
  const grid = opts.grid ?? equalGrid(columnCount(rows));
  return { kind: "table", grid, rows, properties: opts.properties ?? {} };
}

/** Widest row's logical column count (summing `gridSpan`). */
function columnCount(rows: TableRow[]): number {
  let max = 0;
  for (const row of rows) {
    const cols = row.cells.reduce((n, c) => n + (c.gridSpan ?? 1), 0);
    if (cols > max) max = cols;
  }
  return max;
}

function equalGrid(columns: number): number[] {
  if (columns <= 0) return [];
  const each = Math.floor(DEFAULT_TABLE_WIDTH_TWIPS / columns);
  return Array.from({ length: columns }, () => each);
}
