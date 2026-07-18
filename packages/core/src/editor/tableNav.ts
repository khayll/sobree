import type { InlinePosition, Selection } from "../doc/api";
import { runsLength } from "../doc/runs";
import type { SobreeDocument, Table } from "../doc/types";
import type { CommandBus } from "./types";

/**
 * Table cell NAVIGATION commands — `table.cellNext` / `table.cellPrev`
 * (Tab / Shift+Tab in the keyboard plugin, but reachable by any command-bus
 * caller: toolbar, MCP, agents).
 *
 * These live in core, not the keyboard plugin, for the same reason as the
 * mark/history commands (see `coreCommands.ts`): the plugin only maps
 * keystrokes onto `execute(...)`.
 *
 * Movement is over the table's AST cells in reading order — across the row,
 * then on to the next row — skipping `vMerge: "continue"` cells, which render
 * nothing (their column is covered by the restart cell above). At the last
 * cell, `next` is a no-op (as is `prev` at the first): the command stays
 * available so Tab is still consumed and focus doesn't escape the editor
 * mid-table. Word would insert a new row there; that's a structural edit
 * (with its own track-changes story) deliberately out of scope here.
 *
 * Landing behaviour matches Word: the target cell's first paragraph is
 * SELECTED in full (typing replaces it), collapsing to a caret when the cell
 * is empty or its first block isn't a paragraph (e.g. a nested table).
 */

/** The slice of the editor the nav commands need. The concrete `Editor`
 *  satisfies it structurally; typing it locally keeps this module a leaf
 *  (same pattern as `TableHost` in `table.ts`). */
export interface TableNavHost {
  getDocument(): SobreeDocument;
  getBlockById(id: string): { id: string; version: number; kind: string; index: number } | null;
  selection: {
    get(): Selection;
    set(sel: Selection): boolean;
  };
}

type CellAddress = NonNullable<InlinePosition["cell"]>;

/** The selection's focus position when it sits inside a table cell. */
function focusCell(sel: Selection): InlinePosition | null {
  if (!sel) return null;
  const at = sel.kind === "caret" ? sel.at : sel.range.from;
  return at.cell ? at : null;
}

/** The table block a cell position addresses, or `null`. */
function tableAt(host: TableNavHost, at: InlinePosition): { table: Table; index: number } | null {
  const info = host.getBlockById(at.block.id);
  if (!info || info.kind !== "table") return null;
  const table = host.getDocument().body[info.index];
  return table?.kind === "table" ? { table, index: info.index } : null;
}

/**
 * The rendered cell adjacent to `cell` in reading order (`dir` +1 = next,
 * -1 = previous), or `null` at the table boundary. Walks the AST cell
 * arrays, skipping `vMerge: "continue"` cells — they emit no element, so
 * landing "in" one would put the caret nowhere.
 */
export function adjacentCell(
  table: Table,
  cell: { row: number; col: number },
  dir: 1 | -1,
): { row: number; col: number } | null {
  const rendered: { row: number; col: number }[] = [];
  table.rows.forEach((row, r) => {
    row.cells.forEach((c, i) => {
      if (c.vMerge !== "continue") rendered.push({ row: r, col: i });
    });
  });
  const here = rendered.findIndex((p) => p.row === cell.row && p.col === cell.col);
  if (here < 0) return null;
  return rendered[here + dir] ?? null;
}

/** Move the selection to `target`, selecting its first paragraph's content. */
function selectCell(
  host: TableNavHost,
  at: InlinePosition,
  target: { row: number; col: number },
): void {
  const resolved = tableAt(host, at);
  const info = host.getBlockById(at.block.id);
  if (!resolved || !info) return;
  const first = resolved.table.rows[target.row]?.cells[target.col]?.content[0];
  const length = first?.kind === "paragraph" ? runsLength(first.runs) : 0;
  const block = { id: info.id, version: info.version };
  const cell: CellAddress = { row: target.row, col: target.col, blockIndex: 0 };
  const from: InlinePosition = { block, offset: 0, cell };
  if (length === 0) {
    host.selection.set({ kind: "caret", at: from });
    return;
  }
  host.selection.set({ kind: "range", range: { from, to: { block, offset: length, cell } } });
}

function moveCell(host: TableNavHost, dir: 1 | -1): void {
  const sel = host.selection.get();
  const at = focusCell(sel);
  if (!at?.cell) return;
  const resolved = tableAt(host, at);
  if (!resolved) return;
  const target = adjacentCell(resolved.table, at.cell, dir);
  // Boundary (first/last cell): consumed no-op — see the module doc.
  if (!target) return;
  selectCell(host, at, target);
}

/** Whether the current selection can be table-navigated at all. */
function available(host: TableNavHost): boolean {
  const at = focusCell(host.selection.get());
  return at !== null && tableAt(host, at) !== null;
}

/** Register `table.cellNext` / `table.cellPrev` on the bus. */
export function registerTableNavCommands(commands: CommandBus, host: TableNavHost): void {
  commands.register({
    name: "table.cellNext",
    title: "Next table cell",
    run: () => moveCell(host, 1),
    isActive: () => false,
    isAvailable: () => available(host),
  });
  commands.register({
    name: "table.cellPrev",
    title: "Previous table cell",
    run: () => moveCell(host, -1),
    isActive: () => false,
    isAvailable: () => available(host),
  });
}
