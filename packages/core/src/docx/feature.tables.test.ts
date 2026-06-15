import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../doc/builders";
import type { Paragraph, SobreeDocument, Table, TableCell } from "../doc/types";
import { exportDocx } from "./export/index";
import { importDocx } from "./import/index";

async function roundTripTable(table: Table): Promise<Table> {
  const doc = emptyDocument();
  doc.body = [table];
  const { bytes } = exportDocx(doc);
  const { document: imported } = await importDocx(bytes);
  const result = imported.body.find((b): b is Table => b.kind === "table");
  if (!result) throw new Error("imported doc contains no table");
  return result;
}

function cell(text_: string, overrides: Partial<TableCell> = {}): TableCell {
  return {
    content: [paragraph([text(text_)])],
    ...overrides,
  };
}

function textOfFirstPara(cell: TableCell): string {
  const para = cell.content.find((b): b is Paragraph => b.kind === "paragraph");
  const run = para?.runs[0];
  return run?.kind === "text" ? run.text : "";
}

describe("DOCX table round-trip", () => {
  it("preserves a plain 2×2 table", async () => {
    const table: Table = {
      kind: "table",
      grid: [2400, 2400],
      rows: [{ isHeader: true, cells: [cell("A"), cell("B")] }, { cells: [cell("1"), cell("2")] }],
      properties: {},
    };
    const back = await roundTripTable(table);
    expect(back.rows).toHaveLength(2);
    expect(back.rows[0]?.isHeader).toBe(true);
    expect(textOfFirstPara(back.rows[0]!.cells[0]!)).toBe("A");
    expect(textOfFirstPara(back.rows[1]!.cells[1]!)).toBe("2");
  });

  it("preserves horizontal merges (gridSpan)", async () => {
    const table: Table = {
      kind: "table",
      grid: [2400, 2400, 2400],
      rows: [
        {
          cells: [cell("merged", { gridSpan: 2 }), cell("alone")],
        },
        { cells: [cell("a"), cell("b"), cell("c")] },
      ],
      properties: {},
    };
    const back = await roundTripTable(table);
    const firstRowFirstCell = back.rows[0]!.cells[0]!;
    expect(firstRowFirstCell.gridSpan).toBe(2);
    expect(textOfFirstPara(firstRowFirstCell)).toBe("merged");
    expect(back.rows[1]!.cells).toHaveLength(3);
  });

  it("preserves vertical merges (vMerge restart + continue)", async () => {
    const table: Table = {
      kind: "table",
      grid: [2400, 2400],
      rows: [
        {
          cells: [cell("spanning", { vMerge: "restart" }), cell("top")],
        },
        {
          cells: [{ vMerge: "continue", content: [paragraph([])] }, cell("bottom")],
        },
      ],
      properties: {},
    };
    const back = await roundTripTable(table);
    expect(back.rows[0]!.cells[0]!.vMerge).toBe("restart");
    expect(back.rows[1]!.cells[0]!.vMerge).toBe("continue");
    expect(textOfFirstPara(back.rows[0]!.cells[0]!)).toBe("spanning");
    expect(textOfFirstPara(back.rows[1]!.cells[1]!)).toBe("bottom");
  });

  it("preserves cell content formatting through vertical alignment", async () => {
    const centred: TableCell = {
      content: [
        {
          kind: "paragraph",
          properties: { alignment: "center" },
          runs: [{ kind: "text", text: "centred", properties: {} }],
        },
      ],
      verticalAlign: "center",
    };
    const table: Table = {
      kind: "table",
      grid: [2400],
      rows: [{ cells: [centred] }],
      properties: {},
    };
    const back = await roundTripTable(table);
    const para = back.rows[0]!.cells[0]!.content[0] as Paragraph;
    expect(para.properties.alignment).toBe("center");
    expect(back.rows[0]!.cells[0]!.verticalAlign).toBe("center");
  });
});

describe("DOM ↔ AST table round-trip with merges", () => {
  it("round-trips rowspan through the DOM", async () => {
    // Import a doc that contains a merged table, re-render via the
    // editor DOM pipeline, then re-serialize and verify the vMerge
    // structure survives.
    const { renderSobreeDocument } = await import("../editor/view/docRenderer/index");
    const { serializeHostsToDocument } = await import("../editor/view/docSerialize/index");

    const doc: SobreeDocument = emptyDocument();
    doc.body = [
      {
        kind: "table",
        grid: [1200, 1200, 1200],
        rows: [
          {
            cells: [cell("stay", { vMerge: "restart" }), cell("row0-b"), cell("row0-c")],
          },
          {
            cells: [
              { vMerge: "continue", content: [paragraph([])] },
              cell("row1-b"),
              cell("row1-c"),
            ],
          },
        ],
        properties: {},
      },
    ];

    const host = document.createElement("div");
    renderSobreeDocument(doc, host);
    // DOM should have 1 <tr> → 3 <td>, 2 <tr> → 2 <td> (continue
    // absorbed into rowspan on the first cell of row 0).
    const trs = host.querySelectorAll("tr");
    expect(trs).toHaveLength(2);
    expect(trs[0]!.querySelectorAll("td")).toHaveLength(3);
    expect(trs[1]!.querySelectorAll("td")).toHaveLength(2);
    expect(trs[0]!.querySelector("td")?.getAttribute("rowspan")).toBe("2");

    const back = serializeHostsToDocument([host]);
    const table = back.body.find((b): b is Table => b.kind === "table");
    if (!table) throw new Error("no table after serialize");
    expect(table.rows[0]!.cells[0]!.vMerge).toBe("restart");
    expect(table.rows[1]!.cells[0]!.vMerge).toBe("continue");
  });
});
