import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { emptyDocument, paragraph, text } from "../doc/builders";
import type { Paragraph, SobreeDocument, Table } from "../doc/types";
import { applyDocumentToYDoc, projectYDoc, seedYDoc } from "./index";
import { Y_BLOCK_AST_KEY, Y_BLOCK_ID_KEY, Y_BODY_KEY } from "./schema";

// Tier 2: tables store cell content as nested Y structure (per-cell props +
// Y.Text content), so concurrent edits to DIFFERENT cells merge instead of
// last-writer-wins clobbering the whole table. These tests prove that, plus
// char-level merge within a cell and the legacy `_ast` migration.

const IDS = ["t0"];

function tableDoc(): SobreeDocument {
  const cell = (t: string) => ({ content: [paragraph([text(t)])] });
  const table: Table = {
    kind: "table",
    grid: [2400, 2400],
    properties: { styleId: "Grid" },
    rows: [{ cells: [cell("a"), cell("b")] }, { cells: [cell("c"), cell("d")] }],
  };
  const doc = emptyDocument();
  doc.body = [table];
  return doc;
}

function clone(doc: SobreeDocument): SobreeDocument {
  return JSON.parse(JSON.stringify(doc)) as SobreeDocument;
}

function table(doc: SobreeDocument): Table {
  return doc.body[0] as Table;
}

function cellText(doc: SobreeDocument, r: number, c: number): string {
  const para = table(doc).rows[r]!.cells[c]!.content[0] as Paragraph;
  return para.runs.map((run) => (run.kind === "text" ? run.text : "")).join("");
}

describe("table Tier 2 — concurrent cell editing merges", () => {
  it("two peers editing DIFFERENT cells both survive", () => {
    const ydocA = new Y.Doc();
    seedYDoc(ydocA, tableDoc(), IDS);
    const ydocB = new Y.Doc();
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA)); // B joins, adopts A's state

    const vecA = Y.encodeStateVector(ydocA);
    const vecB = Y.encodeStateVector(ydocB);

    // A styles cell (0,0); B retypes cell (1,1) — disjoint cells.
    const docA = clone(projectYDoc(ydocA).doc);
    table(docA).rows[0]!.cells[0]!.shading = { fill: "FF0000", pattern: "clear" };
    applyDocumentToYDoc(ydocA, docA, IDS, "local");

    const docB = clone(projectYDoc(ydocB).doc);
    table(docB).rows[1]!.cells[1]!.content = [paragraph([text("EDITED")])];
    applyDocumentToYDoc(ydocB, docB, IDS, "local");

    // Exchange the disjoint updates.
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA, vecB));
    Y.applyUpdate(ydocA, Y.encodeStateAsUpdate(ydocB, vecA));

    const finalA = projectYDoc(ydocA).doc;
    const finalB = projectYDoc(ydocB).doc;

    // Converged…
    expect(finalA).toEqual(finalB);
    // …and BOTH edits survived (no whole-table clobber).
    expect(table(finalA).rows[0]!.cells[0]!.shading).toEqual({ fill: "FF0000", pattern: "clear" });
    expect(cellText(finalA, 1, 1)).toBe("EDITED");
    // Untouched cells intact.
    expect(cellText(finalA, 0, 1)).toBe("b");
    expect(cellText(finalA, 1, 0)).toBe("c");
  });

  it("two peers typing in the SAME cell at different positions merge char-level", () => {
    const ydocA = new Y.Doc();
    // cell (0,0) starts as "hello"
    const doc = tableDoc();
    table(doc).rows[0]!.cells[0]!.content = [paragraph([text("hello")])];
    seedYDoc(ydocA, doc, IDS);
    const ydocB = new Y.Doc();
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA));

    const vecA = Y.encodeStateVector(ydocA);
    const vecB = Y.encodeStateVector(ydocB);

    // A prepends, B appends — different positions in the same Y.Text.
    const docA = clone(projectYDoc(ydocA).doc);
    table(docA).rows[0]!.cells[0]!.content = [paragraph([text("AA hello")])];
    applyDocumentToYDoc(ydocA, docA, IDS, "local");

    const docB = clone(projectYDoc(ydocB).doc);
    table(docB).rows[0]!.cells[0]!.content = [paragraph([text("hello ZZ")])];
    applyDocumentToYDoc(ydocB, docB, IDS, "local");

    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA, vecB));
    Y.applyUpdate(ydocA, Y.encodeStateAsUpdate(ydocB, vecA));

    const merged = cellText(projectYDoc(ydocA).doc, 0, 0);
    expect(projectYDoc(ydocA).doc).toEqual(projectYDoc(ydocB).doc); // converged
    expect(merged).toContain("AA"); // A's prepend survived
    expect(merged).toContain("ZZ"); // B's append survived
    expect(merged).toContain("hello"); // original survived
  });
});

describe("table Tier 2 — legacy `_ast` migration", () => {
  it("projects a pre-nesting whole-table `_ast` Y.Map, then upgrades on edit", () => {
    // Hand-build a legacy Y.Doc: the table as one opaque `_ast` JSON blob
    // (no `rows` Y.Array, no `kind`) — exactly the pre-Tier-2 shape.
    const ydoc = new Y.Doc();
    const legacyTable = table(tableDoc());
    ydoc.transact(() => {
      const body = ydoc.getArray<Y.Map<unknown>>(Y_BODY_KEY);
      const m = new Y.Map<unknown>();
      m.set(Y_BLOCK_ID_KEY, IDS[0]);
      m.set(Y_BLOCK_AST_KEY, JSON.stringify(legacyTable));
      body.insert(0, [m]);
    }, "seed");

    // Reads correctly via the `_ast` fallback.
    expect(projectYDoc(ydoc).doc.body[0]).toEqual(legacyTable);

    // First edit migrates the map to the nested shape…
    const doc = clone(projectYDoc(ydoc).doc);
    table(doc).rows[0]!.cells[0]!.content = [paragraph([text("migrated")])];
    applyDocumentToYDoc(ydoc, doc, IDS, "local");

    // …the underlying map is now nested (has a `rows` Y.Array, no `_ast`)…
    const map = ydoc.getArray<Y.Map<unknown>>(Y_BODY_KEY).get(0);
    expect(map.get("rows")).toBeInstanceOf(Y.Array);
    expect(map.get(Y_BLOCK_AST_KEY)).toBeUndefined();
    // …and still projects correctly with the edit applied.
    expect(cellText(projectYDoc(ydoc).doc, 0, 0)).toBe("migrated");
    expect(cellText(projectYDoc(ydoc).doc, 1, 1)).toBe("d");
  });
});
