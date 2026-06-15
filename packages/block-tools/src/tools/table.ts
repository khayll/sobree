import type { BlockRef } from "@sobree/core";
import type { Editor } from "@sobree/core";
import type { BlockTarget } from "../blockKinds";
import { icon } from "./icons";

export type TableMode = "cell" | "table";

export interface TableContext {
  editor: Editor;
  target: BlockTarget;
  /** Current-cell resolution — null if the caret isn't inside a cell. */
  cell: CellLocation | null;
}

export interface CellLocation {
  row: number;
  col: number;
  element: HTMLTableCellElement;
}

/**
 * Build the table toolbar's HTML. Pill at the top toggles Cell/Table.
 * In Cell mode we show cell-level ops (alignment of the cell's content,
 * vertical alignment, merge / unmerge). In Table mode we show row /
 * column ops plus whole-table toggles.
 *
 * Text tools are NOT included here — the caller (`BlockTools`)
 * prepends the shared text-tools HTML so formatting always applies
 * to the cell content.
 */
export function buildTableToolsHtml(mode: TableMode, hasCell: boolean): string {
  const pill = `
    <div class="tb-divider"></div>
    <div class="tb-pill" role="tablist" aria-label="Table scope">
      <button type="button" data-action="mode" data-arg="cell"
        title="Edit the current cell"
        ${mode === "cell" ? 'class="is-active"' : ""}
        ${!hasCell ? "disabled" : ""}
        aria-pressed="${mode === "cell"}">Cell</button>
      <button type="button" data-action="mode" data-arg="table"
        title="Edit the whole table"
        ${mode === "table" ? 'class="is-active"' : ""}
        aria-pressed="${mode === "table"}">Table</button>
    </div>
    <div class="tb-divider"></div>
  `;

  if (mode === "cell") return pill + buildCellOpsHtml(hasCell);
  return pill + buildTableOpsHtml();
}

export function wireTableTools(
  root: HTMLElement,
  ctx: TableContext,
  onModeChange: (mode: TableMode) => void,
): () => void {
  const onClick = (e: Event) => {
    const btn = (e.target as HTMLElement).closest("button[data-action]");
    if (!btn || btn.hasAttribute("disabled")) return;
    const action = btn.getAttribute("data-action");
    const arg = btn.getAttribute("data-arg");
    if (action === "mode") {
      if (arg === "cell" || arg === "table") onModeChange(arg);
      return;
    }
    const tableRef = tableRefFor(ctx);
    if (!tableRef) return;
    handleAction(ctx, tableRef, action, arg);
  };

  const onChange = (e: Event) => {
    const el = e.target as HTMLElement;
    const role = el.getAttribute("data-role");
    if (!role) return;
    const tableRef = tableRefFor(ctx);
    if (!tableRef) return;
    if (role === "cell-valign" && ctx.cell) {
      const v = (el as HTMLSelectElement).value;
      if (v === "top" || v === "center" || v === "bottom") {
        ctx.editor.table.setCellProperties(
          { table: tableRef, row: ctx.cell.row, col: ctx.cell.col },
          { verticalAlign: v },
        );
      }
    }
  };

  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("change", onChange);
  };
}

// === HTML ===

function buildCellOpsHtml(hasCell: boolean): string {
  const disabled = hasCell ? "" : "disabled";
  return `
    <div class="tb-group" data-group="cell-align">
      <button type="button" data-action="cell-align" data-arg="left" title="Align left in cell" ${disabled}>${icon("align-left")}</button>
      <button type="button" data-action="cell-align" data-arg="center" title="Align centre in cell" ${disabled}>${icon("align-center")}</button>
      <button type="button" data-action="cell-align" data-arg="right" title="Align right in cell" ${disabled}>${icon("align-right")}</button>
      <select data-role="cell-valign" aria-label="Vertical alignment" title="Vertical align" ${disabled}>
        <option value="">V-align</option>
        <option value="top">Top</option>
        <option value="center">Middle</option>
        <option value="bottom">Bottom</option>
      </select>
    </div>
    <div class="tb-divider"></div>
    <div class="tb-group" data-group="cell-merge">
      <button type="button" data-action="merge-right" title="Merge with cell to the right" ${disabled}>Merge →</button>
      <button type="button" data-action="merge-down" title="Merge with cell below" ${disabled}>Merge ↓</button>
      <button type="button" data-action="unmerge" title="Unmerge" ${disabled}>Unmerge</button>
    </div>
  `;
}

function buildTableOpsHtml(): string {
  return `
    <div class="tb-group" data-group="row-ops">
      <button type="button" data-action="row-above" title="Insert row above">+ Row ↑</button>
      <button type="button" data-action="row-below" title="Insert row below">+ Row ↓</button>
      <button type="button" data-action="delete-row" title="Delete row">${icon("trash")} Row</button>
    </div>
    <div class="tb-divider"></div>
    <div class="tb-group" data-group="col-ops">
      <button type="button" data-action="col-left" title="Insert column left">+ Col ←</button>
      <button type="button" data-action="col-right" title="Insert column right">+ Col →</button>
      <button type="button" data-action="delete-col" title="Delete column">${icon("trash")} Col</button>
    </div>
    <div class="tb-divider"></div>
    <div class="tb-group" data-group="table-ops">
      <button type="button" data-action="toggle-header-row" title="Toggle first row as header">Header row</button>
      <button type="button" data-action="delete-table" title="Delete table">${icon("trash")} Table</button>
    </div>
  `;
}

// === action dispatch ===

function handleAction(
  ctx: TableContext,
  tableRef: BlockRef,
  action: string | null,
  arg: string | null,
): void {
  if (!action) return;
  const ed = ctx.editor;
  const cell = ctx.cell;
  const row = cell?.row ?? 0;
  const col = cell?.col ?? 0;

  switch (action) {
    case "cell-align": {
      if (!cell) return;
      const a = arg === "left" || arg === "center" || arg === "right" ? arg : "left";
      // Set alignment on the FIRST paragraph in the cell via setCellContent.
      const info = ed.getBlockById(tableRef.id);
      if (!info) return;
      const doc = ed.getDocument();
      const table = doc.body[info.index];
      if (!table || table.kind !== "table") return;
      const rowObj = table.rows[cell.row];
      const cellObj = rowObj?.cells[cellIndexAt(table, cell.row, cell.col)];
      if (!cellObj) return;
      const newContent = cellObj.content.map((b) =>
        b.kind === "paragraph"
          ? { ...b, properties: { ...b.properties, alignment: a as "left" | "center" | "right" } }
          : b,
      );
      ed.table.setCellContent({ table: tableRef, row: cell.row, col: cell.col }, newContent);
      return;
    }
    case "merge-right":
      if (!cell) return;
      ed.table.mergeCells(tableRef, { row, col, colSpan: 2 });
      return;
    case "merge-down":
      if (!cell) return;
      ed.table.mergeCells(tableRef, { row, col, rowSpan: 2 });
      return;
    case "unmerge":
      if (!cell) return;
      ed.table.unmergeCell({ table: tableRef, row, col });
      return;
    case "row-above":
      ed.table.insertRow(tableRef, { at: "before", index: row });
      return;
    case "row-below":
      ed.table.insertRow(tableRef, { at: "after", index: row });
      return;
    case "delete-row":
      ed.table.deleteRow(tableRef, row);
      return;
    case "col-left":
      ed.table.insertColumn(tableRef, { at: "before", index: col });
      return;
    case "col-right":
      ed.table.insertColumn(tableRef, { at: "after", index: col });
      return;
    case "delete-col":
      ed.table.deleteColumn(tableRef, col);
      return;
    case "toggle-header-row":
      ed.table.toggleHeaderRow(tableRef, 0);
      return;
    case "delete-table":
      ed.deleteBlock(tableRef);
      return;
  }
}

function tableRefFor(ctx: TableContext): BlockRef | null {
  const caret = ctx.editor.selection.currentCaret();
  // The caret might be inside a cell — in which case its block ref is
  // the cell's containing paragraph (a child of the table cell). We
  // need the table block itself; walk `getBlocks()` looking for the
  // table that owns the target element.
  const doc = ctx.editor.getDocument();
  for (let i = 0; i < doc.body.length; i++) {
    if (doc.body[i]?.kind === "table") {
      const info = ctx.editor.getBlock(i);
      const blockEl = ctx.target.element;
      // When the caret is in a cell, `target` is the table element;
      // otherwise fall back to the first table in the body.
      if (!blockEl || blockEl.tagName.toLowerCase() !== "table") continue;
      return { id: info.id, version: info.version };
    }
  }
  // Fallback: first table in the doc.
  const tableBlock = ctx.editor.getBlocks().find((b) => b.kind === "table");
  void caret;
  return tableBlock ? { id: tableBlock.id, version: tableBlock.version } : null;
}

/** Index into `row.cells` for a given visual column. */
function cellIndexAt(table: import("@sobree/core").Table, row: number, col: number): number {
  const r = table.rows[row];
  if (!r) return -1;
  let c = 0;
  for (let i = 0; i < r.cells.length; i++) {
    const span = r.cells[i]?.gridSpan ?? 1;
    if (col >= c && col < c + span) return i;
    c += span;
  }
  return -1;
}

/**
 * Given a `<table>` element and the current caret, return the
 * `{row, col, element}` of the cell under the caret, or `null` if the
 * caret isn't inside a cell in that table.
 */
export function locateCellFromSelection(tableEl: HTMLTableElement): CellLocation | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const anchor = sel.anchorNode;
  if (!anchor) return null;
  const cell = (
    anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as HTMLElement)
  )?.closest("td, th") as HTMLTableCellElement | null;
  if (!cell || !tableEl.contains(cell)) return null;
  const tr = cell.parentElement as HTMLTableRowElement | null;
  if (!tr) return null;
  // Row: position of its <tr> among all <tr>s in the table.
  const allRows = Array.from(tableEl.querySelectorAll("tr"));
  const row = allRows.indexOf(tr);
  // Col: sum of preceding siblings' colspan.
  let col = 0;
  for (const sibling of Array.from(tr.children)) {
    if (sibling === cell) break;
    const cs = Number(sibling.getAttribute("colspan") ?? 1);
    col += Number.isFinite(cs) && cs > 0 ? cs : 1;
  }
  return { row, col, element: cell };
}
