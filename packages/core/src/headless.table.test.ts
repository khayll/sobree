import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { BlockRef } from "./doc/api";
import { emptyDocument, paragraph, text } from "./doc/builders";
import type { Paragraph, SobreeDocument, Table, TableCell } from "./doc/types";
import { Editor } from "./editor";
import { HeadlessSobree } from "./headless";

// The granular table surface (`TableApi`) is shared verbatim between the
// browser `Editor` (`editor.table`) and `HeadlessSobree` (`headless.table`)
// via the `TableHost` interface. These tests prove the headless host drives
// it identically to the DOM editor — same resulting AST, same optimistic
// lock — so an LLM agent never has to hand-build a `Table` block.

function cellOf(t: string, extra: Partial<TableCell> = {}): TableCell {
  return { content: [paragraph([text(t)])], ...extra };
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

function docWithTable(): SobreeDocument {
  const doc = emptyDocument();
  doc.body = [simpleTable()];
  return doc;
}

function makeEditor(): Editor {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new Editor(host, { initialDocument: docWithTable() });
}

function makeHeadless(): HeadlessSobree {
  return new HeadlessSobree(new Y.Doc(), { initialDocument: docWithTable() });
}

type TableHostLike = {
  table: Editor["table"];
  getBlocks(): { id: string; version: number; kind: string }[];
  getDocument(): SobreeDocument;
};

function tableRefOf(host: TableHostLike): BlockRef {
  const b = host.getBlocks().find((x) => x.kind === "table");
  if (!b) throw new Error("no table block");
  return { id: b.id, version: b.version };
}

function tableOf(host: TableHostLike): Table {
  const block = host.getDocument().body[0];
  if (!block || block.kind !== "table") throw new Error("first block is not a table");
  return block;
}

/** Run `op` on a fresh browser editor AND a fresh headless peer, return both
 *  resulting tables for an equality assertion. */
function bothHosts(op: (host: TableHostLike) => void): { ed: Table; hl: Table } {
  const ed = makeEditor();
  const hl = makeHeadless();
  try {
    op(ed);
    op(hl);
    return { ed: tableOf(ed), hl: tableOf(hl) };
  } finally {
    hl.destroy();
  }
}

describe("headless.table — parity with editor.table", () => {
  it("setCellProperties produces identical AST and applies the shading", () => {
    const { ed, hl } = bothHosts((h) =>
      h.table.setCellProperties(
        { table: tableRefOf(h), row: 0, col: 1 },
        { shading: { fill: "F2A900", pattern: "clear" } },
      ),
    );
    expect(hl).toEqual(ed);
    expect(hl.rows[0]!.cells[1]!.shading).toEqual({ fill: "F2A900", pattern: "clear" });
  });

  it("setCellContent produces identical AST", () => {
    const { ed, hl } = bothHosts((h) =>
      h.table.setCellContent({ table: tableRefOf(h), row: 1, col: 2 }, [paragraph([text("Z")])]),
    );
    expect(hl).toEqual(ed);
    const cellPara = hl.rows[1]!.cells[2]!.content[0] as Paragraph;
    expect(cellPara.runs).toEqual([{ kind: "text", text: "Z", properties: {} }]);
  });

  it("insertRow produces identical AST and grows the table", () => {
    const { ed, hl } = bothHosts((h) => h.table.insertRow(tableRefOf(h), { at: "end" }));
    expect(hl).toEqual(ed);
    expect(hl.rows).toHaveLength(3);
  });

  it("mergeCells produces identical AST", () => {
    const { ed, hl } = bothHosts((h) =>
      h.table.mergeCells(tableRefOf(h), { row: 0, col: 0, colSpan: 2 }),
    );
    expect(hl).toEqual(ed);
    expect(hl.rows[0]!.cells[0]!.gridSpan).toBe(2);
  });

  it("setProperties (table style) produces identical AST", () => {
    const { ed, hl } = bothHosts((h) =>
      h.table.setProperties(tableRefOf(h), {
        styleId: "FieldKey",
        look: { firstRow: true, hBand: true },
      }),
    );
    expect(hl).toEqual(ed);
    expect(hl.properties.styleId).toBe("FieldKey");
  });
});

describe("headless.table — inherited optimistic lock", () => {
  it("rejects a stale table ref with optimistic-lock", () => {
    const hl = makeHeadless();
    try {
      const ref = tableRefOf(hl);
      // First edit bumps the table block's version…
      const first = hl.table.toggleHeaderRow(ref, 0);
      expect(first.ok).toBe(true);
      // …so the captured ref is now stale.
      const second = hl.table.insertRow(ref, { at: "end" });
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.error.code).toBe("optimistic-lock");
        if (second.error.code === "optimistic-lock") {
          expect(second.error.conflicts[0]?.blockId).toBe(ref.id);
        }
      }
    } finally {
      hl.destroy();
    }
  });
});
