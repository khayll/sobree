import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../doc/builders";
import type { Paragraph, SobreeDocument, Table, TableCell } from "../doc/types";
import { Editor } from "./";

function setupEditor(table: Table): Editor {
  const doc: SobreeDocument = emptyDocument();
  doc.body = [table];
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new Editor(host, { initialDocument: doc });
}

function cellOf(text_: string, extra: Partial<TableCell> = {}): TableCell {
  return {
    content: [paragraph([text(text_)])],
    ...extra,
  };
}

function simpleTable(): Table {
  return {
    kind: "table",
    grid: [2400, 2400, 2400],
    rows: [
      { cells: [cellOf("a"), cellOf("b"), cellOf("c")] },
      { cells: [cellOf("d"), cellOf("e"), cellOf("f")] },
    ],
    properties: {},
  };
}

function textOfCell(cell: TableCell | undefined): string {
  const p = cell?.content[0] as Paragraph | undefined;
  const run = p?.runs[0];
  return run?.kind === "text" ? run.text : "";
}

function tableFromEditor(ed: Editor): Table {
  const t = ed.getDocument().body.find((b) => b.kind === "table") as Table | undefined;
  if (!t) throw new Error("no table in editor");
  return t;
}

function tableRef(ed: Editor) {
  const b = ed.getBlocks().find((b) => b.kind === "table");
  if (!b) throw new Error("no table block");
  return { id: b.id, version: b.version };
}

describe("editor.table.insertRow", () => {
  it("inserts an empty row at the end", () => {
    const ed = setupEditor(simpleTable());
    const ref = tableRef(ed);
    const r = ed.table.insertRow(ref, { at: "end" });
    expect(r.ok).toBe(true);
    const t = tableFromEditor(ed);
    expect(t.rows).toHaveLength(3);
    expect(t.rows[2]?.cells).toHaveLength(3);
    expect(textOfCell(t.rows[2]?.cells[0])).toBe("");
    ed.destroy();
  });

  it("inserts before a specific row", () => {
    const ed = setupEditor(simpleTable());
    const r = ed.table.insertRow(tableRef(ed), { at: "before", index: 1 });
    expect(r.ok).toBe(true);
    const t = tableFromEditor(ed);
    expect(textOfCell(t.rows[0]?.cells[0])).toBe("a");
    expect(textOfCell(t.rows[1]?.cells[0])).toBe("");
    expect(textOfCell(t.rows[2]?.cells[0])).toBe("d");
    ed.destroy();
  });

  it("accepts a caller-supplied cells array", () => {
    const ed = setupEditor(simpleTable());
    const r = ed.table.insertRow(tableRef(ed), {
      at: "start",
      cells: [cellOf("X"), cellOf("Y"), cellOf("Z")],
    });
    expect(r.ok).toBe(true);
    const t = tableFromEditor(ed);
    expect(textOfCell(t.rows[0]?.cells[0])).toBe("X");
    ed.destroy();
  });

  it("rejects out-of-range index", () => {
    const ed = setupEditor(simpleTable());
    const r = ed.table.insertRow(tableRef(ed), { at: "before", index: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid-position");
    ed.destroy();
  });
});

describe("editor.table.deleteRow", () => {
  it("removes a row", () => {
    const ed = setupEditor(simpleTable());
    const r = ed.table.deleteRow(tableRef(ed), 0);
    expect(r.ok).toBe(true);
    const t = tableFromEditor(ed);
    expect(t.rows).toHaveLength(1);
    expect(textOfCell(t.rows[0]?.cells[0])).toBe("d");
    ed.destroy();
  });

  it("keeps at least one row", () => {
    const single: Table = { ...simpleTable(), rows: [simpleTable().rows[0]!] };
    const ed = setupEditor(single);
    const r = ed.table.deleteRow(tableRef(ed), 0);
    expect(r.ok).toBe(true);
    const t = tableFromEditor(ed);
    expect(t.rows).toHaveLength(1);
    ed.destroy();
  });
});

describe("editor.table.insertColumn", () => {
  it("inserts a column at the end", () => {
    const ed = setupEditor(simpleTable());
    const r = ed.table.insertColumn(tableRef(ed), { at: "end" });
    expect(r.ok).toBe(true);
    const t = tableFromEditor(ed);
    expect(t.grid).toHaveLength(4);
    expect(t.rows[0]?.cells).toHaveLength(4);
    expect(textOfCell(t.rows[0]?.cells[3])).toBe("");
    ed.destroy();
  });

  it("inserts a column before a specific column", () => {
    const ed = setupEditor(simpleTable());
    const r = ed.table.insertColumn(tableRef(ed), { at: "before", index: 1 });
    expect(r.ok).toBe(true);
    const t = tableFromEditor(ed);
    expect(t.grid).toHaveLength(4);
    expect(textOfCell(t.rows[0]?.cells[0])).toBe("a");
    expect(textOfCell(t.rows[0]?.cells[1])).toBe("");
    expect(textOfCell(t.rows[0]?.cells[2])).toBe("b");
    ed.destroy();
  });

  it("extends gridSpan when insertion falls inside a span (default)", () => {
    const t: Table = {
      kind: "table",
      grid: [2400, 2400, 2400],
      rows: [
        { cells: [{ ...cellOf("wide"), gridSpan: 3 }] },
        { cells: [cellOf("x"), cellOf("y"), cellOf("z")] },
      ],
      properties: {},
    };
    const ed = setupEditor(t);
    const r = ed.table.insertColumn(tableRef(ed), { at: "before", index: 1 });
    expect(r.ok).toBe(true);
    const updated = tableFromEditor(ed);
    expect(updated.rows[0]?.cells[0]?.gridSpan).toBe(4);
    expect(updated.rows[1]?.cells).toHaveLength(4);
    ed.destroy();
  });

  it("splits gridSpan when split:true", () => {
    const t: Table = {
      kind: "table",
      grid: [2400, 2400, 2400],
      rows: [
        { cells: [{ ...cellOf("wide"), gridSpan: 3 }] },
        { cells: [cellOf("x"), cellOf("y"), cellOf("z")] },
      ],
      properties: {},
    };
    const ed = setupEditor(t);
    const r = ed.table.insertColumn(tableRef(ed), { at: "before", index: 1, split: true });
    expect(r.ok).toBe(true);
    const updated = tableFromEditor(ed);
    // wide cell split: gridSpan=1 (before insert), new empty cell, gridSpan=2 (after insert)
    const row0 = updated.rows[0]?.cells ?? [];
    const totalSpan = row0.reduce((n, c) => n + (c.gridSpan ?? 1), 0);
    expect(totalSpan).toBe(4);
    ed.destroy();
  });
});

describe("editor.table.deleteColumn", () => {
  it("removes a column", () => {
    const ed = setupEditor(simpleTable());
    const r = ed.table.deleteColumn(tableRef(ed), 1);
    expect(r.ok).toBe(true);
    const t = tableFromEditor(ed);
    expect(t.grid).toHaveLength(2);
    expect(textOfCell(t.rows[0]?.cells[0])).toBe("a");
    expect(textOfCell(t.rows[0]?.cells[1])).toBe("c");
    ed.destroy();
  });

  it("shrinks gridSpan when deleting inside a span", () => {
    const t: Table = {
      kind: "table",
      grid: [2400, 2400, 2400],
      rows: [
        { cells: [{ ...cellOf("wide"), gridSpan: 3 }] },
        { cells: [cellOf("x"), cellOf("y"), cellOf("z")] },
      ],
      properties: {},
    };
    const ed = setupEditor(t);
    const r = ed.table.deleteColumn(tableRef(ed), 1);
    expect(r.ok).toBe(true);
    const updated = tableFromEditor(ed);
    expect(updated.rows[0]?.cells[0]?.gridSpan).toBe(2);
    expect(updated.rows[1]?.cells).toHaveLength(2);
    ed.destroy();
  });

  it("refuses to delete the only column", () => {
    const t: Table = {
      kind: "table",
      grid: [2400],
      rows: [{ cells: [cellOf("only")] }, { cells: [cellOf("row2")] }],
      properties: {},
    };
    const ed = setupEditor(t);
    const r = ed.table.deleteColumn(tableRef(ed), 0);
    expect(r.ok).toBe(false);
    ed.destroy();
  });
});

describe("editor.table.mergeCells + unmergeCell", () => {
  it("merges two cells horizontally", () => {
    const ed = setupEditor(simpleTable());
    const r = ed.table.mergeCells(tableRef(ed), { row: 0, col: 0, colSpan: 2 });
    expect(r.ok).toBe(true);
    const t = tableFromEditor(ed);
    expect(t.rows[0]?.cells).toHaveLength(2);
    expect(t.rows[0]?.cells[0]?.gridSpan).toBe(2);
    ed.destroy();
  });

  it("merges two cells vertically (restart + continue)", () => {
    const ed = setupEditor(simpleTable());
    const r = ed.table.mergeCells(tableRef(ed), { row: 0, col: 0, rowSpan: 2 });
    expect(r.ok).toBe(true);
    const t = tableFromEditor(ed);
    expect(t.rows[0]?.cells[0]?.vMerge).toBe("restart");
    expect(t.rows[1]?.cells[0]?.vMerge).toBe("continue");
    ed.destroy();
  });

  it("merges a 2×2 region", () => {
    const ed = setupEditor(simpleTable());
    const r = ed.table.mergeCells(tableRef(ed), { row: 0, col: 0, rowSpan: 2, colSpan: 2 });
    expect(r.ok).toBe(true);
    const t = tableFromEditor(ed);
    expect(t.rows[0]?.cells[0]?.gridSpan).toBe(2);
    expect(t.rows[0]?.cells[0]?.vMerge).toBe("restart");
    expect(t.rows[1]?.cells[0]?.gridSpan).toBe(2);
    expect(t.rows[1]?.cells[0]?.vMerge).toBe("continue");
    ed.destroy();
  });

  it("refuses to merge if the target already contains a merge", () => {
    const t: Table = {
      kind: "table",
      grid: [2400, 2400, 2400],
      rows: [
        { cells: [cellOf("a"), { ...cellOf("wide"), gridSpan: 2 }] },
        { cells: [cellOf("d"), cellOf("e"), cellOf("f")] },
      ],
      properties: {},
    };
    const ed = setupEditor(t);
    const r = ed.table.mergeCells(tableRef(ed), { row: 0, col: 0, colSpan: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid-state");
    ed.destroy();
  });

  it("unmerges a horizontal merge back into single cells", () => {
    const ed = setupEditor(simpleTable());
    ed.table.mergeCells(tableRef(ed), { row: 0, col: 0, colSpan: 2 });
    const r = ed.table.unmergeCell({ table: tableRef(ed), row: 0, col: 0 });
    expect(r.ok).toBe(true);
    const t = tableFromEditor(ed);
    expect(t.rows[0]?.cells).toHaveLength(3);
    expect(t.rows[0]?.cells[0]?.gridSpan).toBeUndefined();
    ed.destroy();
  });

  it("unmerges a vertical merge back into individual cells", () => {
    const ed = setupEditor(simpleTable());
    ed.table.mergeCells(tableRef(ed), { row: 0, col: 0, rowSpan: 2 });
    const r = ed.table.unmergeCell({ table: tableRef(ed), row: 0, col: 0 });
    expect(r.ok).toBe(true);
    const t = tableFromEditor(ed);
    expect(t.rows[0]?.cells[0]?.vMerge).toBeUndefined();
    expect(t.rows[1]?.cells[0]?.vMerge).toBeUndefined();
    ed.destroy();
  });
});

describe("editor.table.setCellContent / setCellProperties", () => {
  it("replaces cell content", () => {
    const ed = setupEditor(simpleTable());
    const r = ed.table.setCellContent({ table: tableRef(ed), row: 1, col: 1 }, [
      paragraph([text("changed")]),
    ]);
    expect(r.ok).toBe(true);
    const t = tableFromEditor(ed);
    expect(textOfCell(t.rows[1]?.cells[1])).toBe("changed");
    ed.destroy();
  });

  it("merges cell properties", () => {
    const ed = setupEditor(simpleTable());
    const r = ed.table.setCellProperties(
      { table: tableRef(ed), row: 0, col: 0 },
      { verticalAlign: "center" },
    );
    expect(r.ok).toBe(true);
    const t = tableFromEditor(ed);
    expect(t.rows[0]?.cells[0]?.verticalAlign).toBe("center");
    ed.destroy();
  });
});

describe("editor.table.setColumnWidth / toggleHeaderRow / setProperties", () => {
  it("updates a column width", () => {
    const ed = setupEditor(simpleTable());
    const r = ed.table.setColumnWidth(tableRef(ed), 1, 4800);
    expect(r.ok).toBe(true);
    expect(tableFromEditor(ed).grid[1]).toBe(4800);
    ed.destroy();
  });

  it("toggles isHeader on a row", () => {
    const ed = setupEditor(simpleTable());
    expect(tableFromEditor(ed).rows[0]?.isHeader).toBeFalsy();
    ed.table.toggleHeaderRow(tableRef(ed), 0);
    expect(tableFromEditor(ed).rows[0]?.isHeader).toBe(true);
    ed.table.toggleHeaderRow(tableRef(ed), 0);
    expect(tableFromEditor(ed).rows[0]?.isHeader).toBeFalsy();
    ed.destroy();
  });

  it("merges TableProperties patches", () => {
    const ed = setupEditor(simpleTable());
    const r = ed.table.setProperties(tableRef(ed), { alignment: "center", widthTwips: 8000 });
    expect(r.ok).toBe(true);
    const t = tableFromEditor(ed);
    expect(t.properties.alignment).toBe("center");
    expect(t.properties.widthTwips).toBe(8000);
    ed.destroy();
  });
});

describe("editor.table optimistic locking", () => {
  it("returns optimistic-lock when using a stale ref", () => {
    const ed = setupEditor(simpleTable());
    const stale = tableRef(ed);
    // Do an edit first, bumping the version.
    ed.table.toggleHeaderRow(stale, 0);
    // Re-try with the old ref.
    const r = ed.table.insertRow(stale, { at: "end" });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.code === "optimistic-lock") {
      expect(r.error.conflicts[0]?.blockId).toBe(stale.id);
    } else {
      throw new Error("expected optimistic-lock");
    }
    ed.destroy();
  });
});
