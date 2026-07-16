import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, table, tableCell, tableRow, text } from "../doc/builders";
import type { SobreeDocument, Table } from "../doc/types";
import { Editor } from "./";
import { adjacentCell } from "./tableNav";

/**
 * `table.cellNext` / `table.cellPrev` — the command-bus half of Tab
 * navigation in tables (the keyboard plugin maps Tab/Shift+Tab onto these).
 * Movement is over AST cells in reading order, skipping `vMerge: "continue"`
 * cells; the target cell's first paragraph is selected in full (Word
 * behaviour); the table boundary is a consumed no-op.
 */

function grid2x2(): SobreeDocument {
  const d = emptyDocument();
  d.body = [
    table([
      tableRow([tableCell([paragraph([text("a")])]), tableCell([paragraph([text("bb")])])]),
      tableRow([tableCell([paragraph([text("c")])]), tableCell([paragraph([text("d")])])]),
    ]),
  ];
  return d;
}

function editor(doc: SobreeDocument): Editor {
  const ed = new Editor(document.createElement("div"), { initialDocument: doc });
  document.body.appendChild((ed as unknown as { host: HTMLElement }).host);
  return ed;
}

function cellCaret(ed: Editor, row: number, col: number, offset = 0): void {
  const b = ed.getBlock(0);
  ed.selection.set({
    kind: "caret",
    at: {
      block: { id: b.id, version: b.version },
      offset,
      cell: { row, col, blockIndex: 0 },
    },
  });
}

describe("table.cellNext / table.cellPrev", () => {
  it("is unavailable when the caret is not in a table cell", () => {
    const d = emptyDocument();
    d.body = [paragraph([text("plain")])];
    const ed = editor(d);
    const b = ed.getBlock(0);
    ed.selection.set({
      kind: "caret",
      at: { block: { id: b.id, version: b.version }, offset: 0 },
    });
    expect(ed.commands.isAvailable("table.cellNext")).toBe(false);
    expect(ed.commands.isAvailable("table.cellPrev")).toBe(false);
    ed.destroy();
  });

  it("is available with a caret in a cell", () => {
    const ed = editor(grid2x2());
    cellCaret(ed, 0, 0);
    expect(ed.commands.isAvailable("table.cellNext")).toBe(true);
    ed.destroy();
  });

  it("next moves across the row and SELECTS the target cell's content", () => {
    const ed = editor(grid2x2());
    cellCaret(ed, 0, 0, 1);

    ed.commands.execute("table.cellNext");

    const sel = ed.selection.get();
    expect(sel?.kind).toBe("range");
    if (sel?.kind !== "range") return;
    expect(sel.range.from.cell).toEqual({ row: 0, col: 1, blockIndex: 0 });
    expect(sel.range.from.offset).toBe(0);
    expect(sel.range.to.offset).toBe(2); // "bb" fully selected
    ed.destroy();
  });

  it("next wraps from the end of a row to the next row's first cell", () => {
    const ed = editor(grid2x2());
    cellCaret(ed, 0, 1);

    ed.commands.execute("table.cellNext");

    const sel = ed.selection.get();
    const at = sel?.kind === "range" ? sel.range.from : sel?.kind === "caret" ? sel.at : null;
    expect(at?.cell).toEqual({ row: 1, col: 0, blockIndex: 0 });
    ed.destroy();
  });

  it("prev moves back, wrapping to the previous row's last cell", () => {
    const ed = editor(grid2x2());
    cellCaret(ed, 1, 0);

    ed.commands.execute("table.cellPrev");

    const sel = ed.selection.get();
    const at = sel?.kind === "range" ? sel.range.from : sel?.kind === "caret" ? sel.at : null;
    expect(at?.cell).toEqual({ row: 0, col: 1, blockIndex: 0 });
    ed.destroy();
  });

  it("next in the LAST cell is a no-op (selection unchanged, still consumed)", () => {
    const ed = editor(grid2x2());
    cellCaret(ed, 1, 1, 1);

    ed.commands.execute("table.cellNext");

    const sel = ed.selection.get();
    expect(sel?.kind).toBe("caret");
    if (sel?.kind !== "caret") return;
    expect(sel.at.cell).toEqual({ row: 1, col: 1, blockIndex: 0 });
    expect(sel.at.offset).toBe(1);
    ed.destroy();
  });

  it("lands as a CARET in an empty cell", () => {
    const d = emptyDocument();
    d.body = [table([tableRow([tableCell([paragraph([text("x")])]), tableCell([paragraph([])])])])];
    const ed = editor(d);
    cellCaret(ed, 0, 0);

    ed.commands.execute("table.cellNext");

    const sel = ed.selection.get();
    expect(sel?.kind).toBe("caret");
    if (sel?.kind !== "caret") return;
    expect(sel.at.cell).toEqual({ row: 0, col: 1, blockIndex: 0 });
    ed.destroy();
  });
});

describe("adjacentCell — vMerge occlusion", () => {
  it("skips vMerge:'continue' cells (they render nothing)", () => {
    // Column 0 is merged over both rows: row 1's col 0 is a continue cell.
    // Moving forward from (0,1) must land on (1,1), never on (1,0).
    const t = table([
      tableRow([
        { ...tableCell([paragraph([text("merged")])]), vMerge: "restart" },
        tableCell([paragraph([text("top")])]),
      ]),
      tableRow([{ ...tableCell([]), vMerge: "continue" }, tableCell([paragraph([text("under")])])]),
    ]) as Table;

    expect(adjacentCell(t, { row: 0, col: 1 }, 1)).toEqual({ row: 1, col: 1 });
    expect(adjacentCell(t, { row: 1, col: 1 }, -1)).toEqual({ row: 0, col: 1 });
  });

  it("returns null at the table boundary and for an unknown address", () => {
    const t = table([tableRow([tableCell([paragraph([text("only")])])])]) as Table;
    expect(adjacentCell(t, { row: 0, col: 0 }, 1)).toBeNull();
    expect(adjacentCell(t, { row: 0, col: 0 }, -1)).toBeNull();
    expect(adjacentCell(t, { row: 5, col: 5 }, 1)).toBeNull();
  });
});
