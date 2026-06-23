import type { BlockRef, EditResult } from "../doc/api";
import { fail } from "../doc/api";
import type { SobreeDocument } from "../doc/types";
import type {
  Block,
  ParagraphAlignment,
  Shading,
  Table,
  TableCell,
  TableCellBorders,
  TableProperties,
  TableRow,
} from "../doc/types";

/**
 * Minimal slice of an editor-like peer that `TableApi` needs. Both the
 * browser `Editor` and the no-DOM `HeadlessSobree` satisfy it structurally,
 * so the same table surface drives `editor.table` and `headless.table`.
 * Defining it here (rather than `import type { Editor } from "./"`) keeps
 * this module a leaf in the editor/* import graph — no cycle with index.ts.
 */
export interface TableHost {
  getDocument(): SobreeDocument;
  getBlockById(id: string): { kind: string; index: number } | null;
  replaceBlock(target: BlockRef, block: Block): EditResult<BlockRef>;
}

/**
 * Pointer to one cell inside a table. `row`/`col` are **visual** indices
 * (after expanding `gridSpan`) — the grid the user actually sees. Not a
 * stable handle: indices shift as rows/columns are added or removed.
 */
export interface CellRef {
  table: BlockRef;
  row: number;
  col: number;
}

/** Where an insertion should land, relative to an anchor row/column. */
export type InsertAt = "start" | "end" | "before" | "after";

export interface InsertRowOpts {
  at: InsertAt;
  /** Required for `"before"` / `"after"`. Visual row index of the anchor. */
  index?: number;
  /** Custom cells. Defaults to empty paragraphs, one per grid column. */
  cells?: TableCell[];
}

export interface InsertColumnOpts {
  at: InsertAt;
  /** Required for `"before"` / `"after"`. Visual column index of the anchor. */
  index?: number;
  /** Width of the new column in twips. Default: average of existing columns, or 2400. */
  widthTwips?: number;
  /**
   * When the target column falls inside an existing `gridSpan` cell, the
   * default is to **extend** the span (the existing merge grows). Pass
   * `split: true` to split the merge and insert a fresh cell instead.
   */
  split?: boolean;
}

export interface MergeCellsOpts {
  /** Visual coordinates of the merge region's top-left corner. */
  row: number;
  col: number;
  /** Number of visual rows the merge should span. Defaults to 1. */
  rowSpan?: number;
  /** Number of visual columns the merge should span. Defaults to 1. */
  colSpan?: number;
}

const DEFAULT_COLUMN_WIDTH_TWIPS = 2400;

/**
 * Ergonomic table mutation surface. Lives on `editor.table` (browser) and
 * `headless.table` (no-DOM peer / LLM agents) — same code, via {@link TableHost}.
 *
 * Every method does the same three steps under the hood:
 *   1. Resolve the target table by `BlockRef` (inherits optimistic-lock
 *      checking from the host's `replaceBlock`).
 *   2. Clone and mutate the table immutably.
 *   3. Delegate to the host's `replaceBlock(ref, nextTable)`.
 *
 * No new plumbing; lock semantics, affected-block tracking, and event
 * emission come from the underlying core. Because every edit ultimately
 * round-trips the whole table block, callers never hand-build a `Table`
 * just to tweak one cell — but at the Y.Doc layer it is still a
 * whole-table write (per-cell CRDT is a separate, future change).
 */
export class TableApi {
  constructor(private readonly host: TableHost) {}

  // === row operations ===

  insertRow(ref: BlockRef, opts: InsertRowOpts): EditResult<BlockRef> {
    const table = this.getTable(ref);
    if (!table) return fail({ code: "invalid-state", details: "target is not a table" });

    const colCount = columnCount(table);
    const cells = opts.cells ?? defaultRowCells(colCount);
    if (cells.length > colCount) {
      return fail({
        code: "invalid-state",
        details: `supplied ${cells.length} cells but table has ${colCount} columns`,
      });
    }

    const insertAt = resolveRowInsertIndex(table, opts);
    if (insertAt === null) {
      return fail({ code: "invalid-position", details: "row index out of range" });
    }

    const newRow: TableRow = { cells: padCellsToColumns(cells, colCount) };
    const rows = table.rows.slice();
    rows.splice(insertAt, 0, newRow);

    // If a vertical merge spans across the insert point, the new row's
    // cells in those columns must be `vMerge: "continue"` — otherwise
    // the merge visually breaks.
    patchVMergeAcrossInsertedRow(rows, insertAt);

    return this.host.replaceBlock(ref, { ...table, rows });
  }

  deleteRow(ref: BlockRef, index: number): EditResult<BlockRef> {
    const table = this.getTable(ref);
    if (!table) return fail({ code: "invalid-state", details: "target is not a table" });
    if (index < 0 || index >= table.rows.length) {
      return fail({ code: "invalid-position", details: `row ${index} out of range` });
    }

    const rows = table.rows.slice();
    const removed = rows[index];
    rows.splice(index, 1);

    if (removed) promoteVMergeContinuations(rows, index, removed);

    if (rows.length === 0) {
      // An empty table is invalid; keep at least one row.
      rows.push({ cells: defaultRowCells(columnCount(table)) });
    }
    return this.host.replaceBlock(ref, { ...table, rows });
  }

  // === column operations ===

  insertColumn(ref: BlockRef, opts: InsertColumnOpts): EditResult<BlockRef> {
    const table = this.getTable(ref);
    if (!table) return fail({ code: "invalid-state", details: "target is not a table" });

    const colCount = columnCount(table);
    const at = resolveColumnInsertIndex(colCount, opts);
    if (at === null) {
      return fail({ code: "invalid-position", details: "column index out of range" });
    }

    const width = opts.widthTwips ?? averageColumnWidth(table) ?? DEFAULT_COLUMN_WIDTH_TWIPS;
    const grid = table.grid.slice();
    grid.splice(at, 0, width);

    const rows = table.rows.map((row) => insertColumnInRow(row, at, !!opts.split));
    return this.host.replaceBlock(ref, { ...table, grid, rows });
  }

  deleteColumn(ref: BlockRef, index: number): EditResult<BlockRef> {
    const table = this.getTable(ref);
    if (!table) return fail({ code: "invalid-state", details: "target is not a table" });
    const colCount = columnCount(table);
    if (index < 0 || index >= colCount) {
      return fail({ code: "invalid-position", details: `column ${index} out of range` });
    }
    if (colCount === 1) {
      return fail({
        code: "invalid-state",
        details: "cannot delete the only column; delete the table instead",
      });
    }

    const grid = table.grid.slice();
    grid.splice(index, 1);
    const rows = table.rows.map((row) => deleteColumnFromRow(row, index));
    return this.host.replaceBlock(ref, { ...table, grid, rows });
  }

  // === merge operations ===

  mergeCells(ref: BlockRef, opts: MergeCellsOpts): EditResult<BlockRef> {
    const table = this.getTable(ref);
    if (!table) return fail({ code: "invalid-state", details: "target is not a table" });

    const rowSpan = opts.rowSpan ?? 1;
    const colSpan = opts.colSpan ?? 1;
    if (rowSpan < 1 || colSpan < 1) {
      return fail({ code: "invalid-state", details: "rowSpan/colSpan must be ≥ 1" });
    }
    if (rowSpan === 1 && colSpan === 1) {
      return fail({ code: "invalid-state", details: "merge target is a single cell" });
    }

    const colCount = columnCount(table);
    if (
      opts.row < 0 ||
      opts.col < 0 ||
      opts.row + rowSpan > table.rows.length ||
      opts.col + colSpan > colCount
    ) {
      return fail({ code: "invalid-position", details: "merge region out of range" });
    }

    // Reject if any cell in the target region already participates in a
    // different merge. Users must unmerge first.
    for (let r = opts.row; r < opts.row + rowSpan; r++) {
      for (let c = opts.col; c < opts.col + colSpan; c++) {
        const hit = cellAtVisual(table, r, c);
        if (!hit) continue;
        const isTopLeft = r === opts.row && c === opts.col;
        const ownsOnlyThis = (hit.cell.gridSpan ?? 1) === 1 && !hit.cell.vMerge;
        if (!isTopLeft && !ownsOnlyThis) {
          return fail({
            code: "invalid-state",
            details: "merge region overlaps an existing merge — unmerge it first",
          });
        }
      }
    }

    // Build the merge by mutating each affected row.
    const rows = table.rows.map((row, r) => {
      if (r < opts.row || r >= opts.row + rowSpan) return row;
      return applyMergeToRow(row, r === opts.row, opts.col, colSpan, rowSpan);
    });
    return this.host.replaceBlock(ref, { ...table, rows });
  }

  unmergeCell(cell: CellRef): EditResult<BlockRef> {
    const table = this.getTable(cell.table);
    if (!table) return fail({ code: "invalid-state", details: "target is not a table" });

    const hit = cellAtVisual(table, cell.row, cell.col);
    if (!hit) return fail({ code: "invalid-position", details: "cell not found" });

    const gridSpan = hit.cell.gridSpan ?? 1;
    const isVMergeRoot = hit.cell.vMerge === "restart";

    if (gridSpan === 1 && !isVMergeRoot) {
      return fail({ code: "invalid-state", details: "cell is not merged" });
    }

    // Undo horizontal: replace the one wide cell with N narrow cells.
    // Undo vertical: set the root's vMerge off; find the continuation
    // chain below and replace each with a fresh 1×1 empty cell covering
    // the same visual columns.
    const rows = table.rows.map((row, r) => {
      if (r < cell.row) return row;
      if (r === cell.row) return unmergeTopRow(row, cell.col, gridSpan);
      if (!isVMergeRoot) return row;
      // Below the root: check if this row has a continuation at our cols.
      return unmergeContinuationRow(row, cell.col, gridSpan);
    });

    return this.host.replaceBlock(cell.table, { ...table, rows });
  }

  // === cell ops ===

  setCellContent(cell: CellRef, content: Block[]): EditResult<BlockRef> {
    return this.updateCell(cell, (c) => ({ ...c, content }));
  }

  setCellProperties(
    cell: CellRef,
    patch: Partial<Omit<TableCell, "content">>,
  ): EditResult<BlockRef> {
    return this.updateCell(cell, (c) => mergeCellProps(c, patch));
  }

  // === column / row / table ops ===

  setColumnWidth(ref: BlockRef, col: number, widthTwips: number): EditResult<BlockRef> {
    const table = this.getTable(ref);
    if (!table) return fail({ code: "invalid-state", details: "target is not a table" });
    if (col < 0 || col >= table.grid.length) {
      return fail({ code: "invalid-position", details: `column ${col} out of range` });
    }
    if (widthTwips <= 0) {
      return fail({ code: "invalid-state", details: "widthTwips must be positive" });
    }
    const grid = table.grid.slice();
    grid[col] = widthTwips;
    return this.host.replaceBlock(ref, { ...table, grid });
  }

  toggleHeaderRow(ref: BlockRef, row: number): EditResult<BlockRef> {
    const table = this.getTable(ref);
    if (!table) return fail({ code: "invalid-state", details: "target is not a table" });
    if (row < 0 || row >= table.rows.length) {
      return fail({ code: "invalid-position", details: `row ${row} out of range` });
    }
    const rows = table.rows.map((r, i) => {
      if (i !== row) return r;
      return r.isHeader ? { ...r, isHeader: false } : { ...r, isHeader: true };
    });
    return this.host.replaceBlock(ref, { ...table, rows });
  }

  setProperties(ref: BlockRef, patch: Partial<TableProperties>): EditResult<BlockRef> {
    const table = this.getTable(ref);
    if (!table) return fail({ code: "invalid-state", details: "target is not a table" });
    return this.host.replaceBlock(ref, {
      ...table,
      properties: { ...table.properties, ...patch },
    });
  }

  // === internals ===

  private getTable(ref: BlockRef): Table | null {
    const doc = this.host.getDocument();
    const info = this.host.getBlockById(ref.id);
    if (!info || info.kind !== "table") return null;
    const block = doc.body[info.index];
    if (!block || block.kind !== "table") return null;
    return block;
  }

  private updateCell(cell: CellRef, transform: (c: TableCell) => TableCell): EditResult<BlockRef> {
    const table = this.getTable(cell.table);
    if (!table) return fail({ code: "invalid-state", details: "target is not a table" });
    const rows = table.rows.slice();
    const target = rows[cell.row];
    if (!target) return fail({ code: "invalid-position", details: "row not found" });
    const hit = cellAtVisual(table, cell.row, cell.col);
    if (!hit) return fail({ code: "invalid-position", details: "cell not found" });
    const newCells = target.cells.slice();
    newCells[hit.cellIndex] = transform(hit.cell);
    rows[cell.row] = { ...target, cells: newCells };
    return this.host.replaceBlock(cell.table, { ...table, rows });
  }
}

// === helper functions (pure) ===

/** Total visible column count for a table — max over rows. */
function columnCount(table: Table): number {
  return Math.max(
    table.grid.length,
    ...table.rows.map((r) => r.cells.reduce((n, c) => n + (c.gridSpan ?? 1), 0)),
  );
}

/** Default content for a fresh cell: one empty paragraph. */
function emptyCell(): TableCell {
  return { content: [{ kind: "paragraph", properties: {}, runs: [] }] };
}

function defaultRowCells(colCount: number): TableCell[] {
  return Array.from({ length: colCount }, () => emptyCell());
}

function padCellsToColumns(cells: TableCell[], colCount: number): TableCell[] {
  const totalSpan = cells.reduce((n, c) => n + (c.gridSpan ?? 1), 0);
  if (totalSpan >= colCount) return cells;
  const deficit = colCount - totalSpan;
  return [...cells, ...Array.from({ length: deficit }, () => emptyCell())];
}

function averageColumnWidth(table: Table): number | null {
  if (table.grid.length === 0) return null;
  const total = table.grid.reduce((n, w) => n + w, 0);
  return Math.round(total / table.grid.length);
}

function resolveRowInsertIndex(table: Table, opts: InsertRowOpts): number | null {
  if (opts.at === "start") return 0;
  if (opts.at === "end") return table.rows.length;
  if (opts.index === undefined) return null;
  if (opts.index < 0 || opts.index >= table.rows.length) return null;
  return opts.at === "before" ? opts.index : opts.index + 1;
}

function resolveColumnInsertIndex(colCount: number, opts: InsertColumnOpts): number | null {
  if (opts.at === "start") return 0;
  if (opts.at === "end") return colCount;
  if (opts.index === undefined) return null;
  if (opts.index < 0 || opts.index >= colCount) return null;
  return opts.at === "before" ? opts.index : opts.index + 1;
}

/**
 * Given a `(row, col)` in *visual* coordinates, find which TableCell in
 * `row.cells` holds that position, accounting for `gridSpan`.
 */
export function cellAtVisual(
  table: Table,
  row: number,
  col: number,
): { cellIndex: number; cell: TableCell; startCol: number } | null {
  const r = table.rows[row];
  if (!r) return null;
  let c = 0;
  for (let i = 0; i < r.cells.length; i++) {
    const cell = r.cells[i];
    if (!cell) continue;
    const span = cell.gridSpan ?? 1;
    if (col >= c && col < c + span) {
      return { cellIndex: i, cell, startCol: c };
    }
    c += span;
  }
  return null;
}

/**
 * After inserting a new row at `insertAt`, scan the surrounding rows: if
 * a vertical merge spanned across the insertion point (restart above,
 * continue below), the newly-inserted row must carry `continue` cells in
 * those columns so the merge doesn't visually break.
 */
function patchVMergeAcrossInsertedRow(rows: TableRow[], insertAt: number): void {
  if (insertAt === 0 || insertAt === rows.length - 0) return;
  const newRow = rows[insertAt];
  const above = rows[insertAt - 1];
  const below = rows[insertAt + 1];
  if (!newRow || !above || !below) return;

  let aboveCol = 0;
  for (const aCell of above.cells) {
    const span = aCell.gridSpan ?? 1;
    const isRestartOrContinue = aCell.vMerge === "restart" || aCell.vMerge === "continue";
    const belowCell = cellAtVisual({ rows, grid: [], properties: {}, kind: "table" }, 1, aboveCol);
    const belowContinues = belowCell?.cell.vMerge === "continue";
    if (isRestartOrContinue && belowContinues) {
      insertContinueInRowAtVisual(newRow, aboveCol, span);
    }
    aboveCol += span;
  }
}

function insertContinueInRowAtVisual(row: TableRow, startCol: number, gridSpan: number): void {
  let c = 0;
  let insertAtIndex = row.cells.length;
  for (let i = 0; i < row.cells.length; i++) {
    if (c >= startCol) {
      insertAtIndex = i;
      break;
    }
    c += row.cells[i]?.gridSpan ?? 1;
  }
  const cell: TableCell = {
    vMerge: "continue",
    content: [{ kind: "paragraph", properties: {}, runs: [] }],
  };
  if (gridSpan > 1) cell.gridSpan = gridSpan;
  row.cells.splice(insertAtIndex, 0, cell);
}

/**
 * When a row containing `vMerge: "restart"` is removed, the first
 * `continue` below it in each affected column must be promoted to
 * `restart` — otherwise the merge has no anchor.
 */
function promoteVMergeContinuations(
  rows: TableRow[],
  removedIndex: number,
  removed: TableRow,
): void {
  let col = 0;
  for (const cell of removed.cells) {
    const span = cell.gridSpan ?? 1;
    if (cell.vMerge === "restart") {
      // Find the first continuation at `col` among rows[removedIndex ..].
      const successorRowIndex = rows.findIndex((_row, i) => {
        if (i < removedIndex) return false;
        const hit = cellAtVisual({ rows, grid: [], properties: {}, kind: "table" }, i, col);
        return hit?.cell.vMerge === "continue";
      });
      if (successorRowIndex >= 0) {
        const r = rows[successorRowIndex];
        const hit = cellAtVisual(
          { rows, grid: [], properties: {}, kind: "table" },
          successorRowIndex,
          col,
        );
        if (r && hit) {
          const newCells = r.cells.slice();
          const promoted: TableCell = { ...hit.cell };
          delete (promoted as Partial<TableCell>).vMerge;
          newCells[hit.cellIndex] = promoted;
          rows[successorRowIndex] = { ...r, cells: newCells };
        }
      }
    }
    col += span;
  }
}

/** Insert a column into a single row at the visual `atCol`. */
function insertColumnInRow(row: TableRow, atCol: number, splitMerge: boolean): TableRow {
  let c = 0;
  const newCells: TableCell[] = [];
  let inserted = false;

  for (let i = 0; i < row.cells.length; i++) {
    const cell = row.cells[i];
    if (!cell) continue;
    const span = cell.gridSpan ?? 1;

    if (!inserted && atCol <= c) {
      newCells.push(emptyCell());
      inserted = true;
    }
    if (!inserted && atCol > c && atCol < c + span) {
      // Insertion falls inside this cell's span.
      if (splitMerge) {
        // Split: reduce this cell to cover up to atCol-c, insert fresh cell,
        // append a remainder cell covering the rest.
        const leftSpan = atCol - c;
        const rightSpan = span - leftSpan;
        const left: TableCell = { ...cell };
        if (leftSpan > 1) left.gridSpan = leftSpan;
        else delete (left as Partial<TableCell>).gridSpan;
        newCells.push(left);
        newCells.push(emptyCell());
        const right: TableCell = { ...emptyCell() };
        if (rightSpan > 1) right.gridSpan = rightSpan;
        newCells.push(right);
      } else {
        // Extend: grow this cell's span by 1.
        const extended: TableCell = { ...cell, gridSpan: span + 1 };
        newCells.push(extended);
      }
      inserted = true;
      c += span;
      continue;
    }

    newCells.push(cell);
    c += span;
  }

  if (!inserted) newCells.push(emptyCell());
  return { ...row, cells: newCells };
}

/** Delete a column from a single row at the visual `atCol`. */
function deleteColumnFromRow(row: TableRow, atCol: number): TableRow {
  let c = 0;
  const newCells: TableCell[] = [];

  for (let i = 0; i < row.cells.length; i++) {
    const cell = row.cells[i];
    if (!cell) continue;
    const span = cell.gridSpan ?? 1;

    if (atCol >= c && atCol < c + span) {
      if (span === 1) {
        // Drop the cell entirely.
      } else {
        // Shrink the span by one.
        const shrunk: TableCell = { ...cell };
        if (span - 1 > 1) shrunk.gridSpan = span - 1;
        else delete (shrunk as Partial<TableCell>).gridSpan;
        newCells.push(shrunk);
      }
    } else {
      newCells.push(cell);
    }

    c += span;
  }

  return { ...row, cells: newCells };
}

/**
 * Apply a rectangle merge across one row. `isTopRow` distinguishes the
 * root (gets `gridSpan` + optional `vMerge: restart`) from the
 * continuation rows (get `continue` placeholders across the merge span).
 */
function applyMergeToRow(
  row: TableRow,
  isTopRow: boolean,
  startCol: number,
  colSpan: number,
  rowSpan: number,
): TableRow {
  let c = 0;
  const newCells: TableCell[] = [];

  for (let i = 0; i < row.cells.length; i++) {
    const cell = row.cells[i];
    if (!cell) continue;
    const span = cell.gridSpan ?? 1;

    if (c < startCol) {
      newCells.push(cell);
    } else if (c === startCol && isTopRow) {
      const merged: TableCell = { ...cell };
      if (colSpan > 1) merged.gridSpan = colSpan;
      if (rowSpan > 1) merged.vMerge = "restart";
      newCells.push(merged);
    } else if (c >= startCol && c < startCol + colSpan) {
      if (!isTopRow && c === startCol) {
        // Continuation row, left-edge cell: becomes the "continue" anchor.
        const cont: TableCell = {
          vMerge: "continue",
          content: [{ kind: "paragraph", properties: {}, runs: [] }],
        };
        if (colSpan > 1) cont.gridSpan = colSpan;
        newCells.push(cont);
      }
      // Skip other cells inside the merge region.
    } else {
      newCells.push(cell);
    }
    c += span;
  }

  return { ...row, cells: newCells };
}

/** Split the root row of a previously-merged cell back into individual cells. */
function unmergeTopRow(row: TableRow, startCol: number, gridSpan: number): TableRow {
  let c = 0;
  const newCells: TableCell[] = [];
  for (let i = 0; i < row.cells.length; i++) {
    const cell = row.cells[i];
    if (!cell) continue;
    const span = cell.gridSpan ?? 1;
    if (c === startCol) {
      // Replace with `gridSpan` single cells; first keeps content + props
      // minus merge markers.
      const primary: TableCell = { ...cell };
      delete (primary as Partial<TableCell>).gridSpan;
      delete (primary as Partial<TableCell>).vMerge;
      newCells.push(primary);
      for (let k = 1; k < gridSpan; k++) newCells.push(emptyCell());
    } else {
      newCells.push(cell);
    }
    c += span;
  }
  return { ...row, cells: newCells };
}

/** Replace a vertical-merge continuation row's placeholder with fresh cells. */
function unmergeContinuationRow(row: TableRow, startCol: number, gridSpan: number): TableRow {
  let c = 0;
  const newCells: TableCell[] = [];
  for (let i = 0; i < row.cells.length; i++) {
    const cell = row.cells[i];
    if (!cell) continue;
    const span = cell.gridSpan ?? 1;
    if (c === startCol && cell.vMerge === "continue") {
      // Expand to fresh cells covering the same column span.
      for (let k = 0; k < gridSpan; k++) newCells.push(emptyCell());
    } else {
      newCells.push(cell);
    }
    c += span;
  }
  return { ...row, cells: newCells };
}

/** Merge patch into a TableCell's per-field properties. */
function mergeCellProps(cell: TableCell, patch: Partial<Omit<TableCell, "content">>): TableCell {
  const out: TableCell = { ...cell };
  const keys: Array<keyof Omit<TableCell, "content">> = [
    "gridSpan",
    "vMerge",
    "verticalAlign",
    "shading",
    "borders",
  ];
  for (const key of keys) {
    if (key in patch) {
      const value = patch[key];
      if (value === undefined) {
        delete (out as Partial<TableCell>)[key];
      } else {
        assignCellProp(out, key, value);
      }
    }
  }
  return out;
}

function assignCellProp<K extends keyof Omit<TableCell, "content">>(
  cell: TableCell,
  key: K,
  value: NonNullable<Omit<TableCell, "content">[K]>,
): void {
  if (key === "gridSpan" && typeof value === "number") cell.gridSpan = value;
  else if (key === "vMerge" && (value === "restart" || value === "continue")) cell.vMerge = value;
  else if (key === "verticalAlign" && typeof value === "string")
    cell.verticalAlign = value as "top" | "center" | "bottom";
  else if (key === "shading") cell.shading = value as Shading;
  else if (key === "borders") cell.borders = value as TableCellBorders;
}

/** Used internally by alignment setters in the toolbar. */
export type TableCellAlignment = ParagraphAlignment;
