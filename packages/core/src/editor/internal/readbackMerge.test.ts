import { describe, expect, it } from "vitest";
import type { Block, Paragraph, Table } from "../../doc/types";
import { mergeReadbackBlocks, mergeReadbackPreservingProps } from "./readbackMerge";

/** A paragraph carrying block-level props the DOM read-back can't represent. */
function styledPara(text: string): Paragraph {
  return {
    kind: "paragraph",
    properties: {
      spacing: { afterTwips: 120 },
      indent: { leftTwips: 360 },
      borders: { bottom: { style: "single", sizeEighthsOfPt: 6, color: "auto", spaceTwips: 1 } },
    },
    runs: [{ kind: "text", text, properties: {} }],
  };
}

/** What the DOM read-back yields for that paragraph: runs only, bare props. */
function readbackPara(text: string): Paragraph {
  return { kind: "paragraph", properties: {}, runs: [{ kind: "text", text, properties: {} }] };
}

function styledTable(cellText: string): Table {
  return {
    kind: "table",
    properties: { styleId: "FieldKey", look: { firstRow: true, hBand: true } },
    grid: [4000],
    rows: [
      {
        cells: [{ shading: { fill: "F2A900", pattern: "clear" }, content: [styledPara(cellText)] }],
      },
    ],
  };
}

function readbackTable(cellText: string): Table {
  return {
    kind: "table",
    properties: {},
    grid: [4000],
    rows: [{ cells: [{ content: [readbackPara(cellText)] }] }],
  };
}

describe("mergeReadbackPreservingProps", () => {
  it("keeps paragraph block props, takes the re-read runs", () => {
    const prev: Block[] = [styledPara("hello")];
    const next: Block[] = [readbackPara("hello world")];
    const [p] = mergeReadbackPreservingProps(prev, next) as [Paragraph];
    // properties survive...
    expect(p.properties.spacing).toEqual({ afterTwips: 120 });
    expect(p.properties.indent).toEqual({ leftTwips: 360 });
    expect(p.properties.borders).toBeDefined();
    // ...content is the freshly-read text.
    expect(p.runs).toEqual([{ kind: "text", text: "hello world", properties: {} }]);
  });

  it("preserves table style / look / cell shading, takes the re-read cell content", () => {
    const prev: Block[] = [styledTable("Cirrus")];
    const next: Block[] = [readbackTable("CirrusX")];
    const [t] = mergeReadbackPreservingProps(prev, next) as [Table];
    expect(t.properties.styleId).toBe("FieldKey");
    expect(t.properties.look).toEqual({ firstRow: true, hBand: true });
    const cell = t.rows[0]!.cells[0]!;
    expect(cell.shading).toEqual({ fill: "F2A900", pattern: "clear" });
    // the cell paragraph keeps its props but gets the edited text
    const cellPara = cell.content[0] as Paragraph;
    expect(cellPara.properties.spacing).toEqual({ afterTwips: 120 });
    expect(cellPara.runs[0]).toEqual({ kind: "text", text: "CirrusX", properties: {} });
  });

  it("falls back to the DOM block when kinds diverge (DOM is authoritative on structure)", () => {
    const prev: Block[] = [styledPara("was a paragraph")];
    const next: Block[] = [readbackTable("now a table")];
    const [b] = mergeReadbackPreservingProps(prev, next);
    expect(b!.kind).toBe("table");
  });

  it("falls back to the DOM table when the row count changed (a structural table edit)", () => {
    const prev: Block[] = [styledTable("one row")];
    const twoRows: Table = {
      ...readbackTable("one row"),
      rows: [...readbackTable("one row").rows, ...readbackTable("two rows").rows],
    };
    const [t] = mergeReadbackPreservingProps(prev, [twoRows]) as [Table];
    // can't safely map rows → take the DOM table wholesale
    expect(t.rows).toHaveLength(2);
    expect(t.properties.styleId).toBeUndefined();
  });

  it("keeps the previous block for kinds the DOM round-trips nothing for (section_break)", () => {
    const prev: Block[] = [{ kind: "section_break", toSectionIndex: 2 }];
    const next: Block[] = [{ kind: "section_break", toSectionIndex: 2 }];
    const [b] = mergeReadbackPreservingProps(prev, next);
    expect(b).toEqual({ kind: "section_break", toSectionIndex: 2 });
  });

  it("takes the DOM block when there is no previous counterpart (appended block)", () => {
    const prev: Block[] = [styledPara("first")];
    const next: Block[] = [readbackPara("first"), readbackPara("second")];
    const merged = mergeReadbackPreservingProps(prev, next);
    expect(merged).toHaveLength(2);
    expect((merged[1] as Paragraph).runs[0]).toEqual({
      kind: "text",
      text: "second",
      properties: {},
    });
  });
});

describe("mergeReadbackBlocks — id-keyed (structural edits)", () => {
  // Mirror what the editor does: previous blocks carry stable ids; each
  // re-read block resolves to its previous block by id, regardless of how
  // the structural shift moved positions.
  it("preserves properties across an inserted block (Enter), matching by id", () => {
    const prev: Block[] = [styledPara("alpha"), styledPara("omega")];
    const prevIds = ["id-a", "id-z"];
    const byId = new Map(prev.map((b, i) => [prevIds[i]!, b]));
    // User pressed Enter inside "alpha", splitting it; a new block appears
    // between the two originals. Source ids as the DOM would report them:
    // the split halves both inherit "id-a"; the untouched tail keeps "id-z".
    const next: Block[] = [readbackPara("al"), readbackPara("pha"), readbackPara("omega")];
    const sourceIds = ["id-a", "id-a", "id-z"];
    const merged = mergeReadbackBlocks(next, (i) => byId.get(sourceIds[i]!));
    // both halves recovered alpha's block props; tail kept omega's
    expect((merged[0] as Paragraph).properties.spacing).toEqual({ afterTwips: 120 });
    expect((merged[1] as Paragraph).properties.indent).toEqual({ leftTwips: 360 });
    expect((merged[2] as Paragraph).properties.spacing).toEqual({ afterTwips: 120 });
    // content is the freshly-read text throughout
    expect((merged[1] as Paragraph).runs).toEqual([{ kind: "text", text: "pha", properties: {} }]);
  });

  it("follows a reordered block's properties by id (not position)", () => {
    const styledA = styledPara("A");
    const styledB = { ...styledPara("B"), properties: { spacing: { afterTwips: 999 } } };
    const byId = new Map<string, Block>([
      ["id-a", styledA],
      ["id-b", styledB],
    ]);
    // The two blocks swapped places in the DOM; ids travel with them.
    const next: Block[] = [readbackPara("B"), readbackPara("A")];
    const sourceIds = ["id-b", "id-a"];
    const merged = mergeReadbackBlocks(next, (i) => byId.get(sourceIds[i]!));
    expect((merged[0] as Paragraph).properties.spacing).toEqual({ afterTwips: 999 });
    expect((merged[1] as Paragraph).properties.spacing).toEqual({ afterTwips: 120 });
  });
});

describe("mergeReadbackPreservingProps — run-property preservation", () => {
  const para = (txt: string, runProps: Record<string, unknown> = {}): Paragraph => ({
    kind: "paragraph",
    properties: {},
    runs: [{ kind: "text", text: txt, properties: runProps }],
  });

  it("keeps run properties on an UNCHANGED paragraph (lossy re-read drops them)", () => {
    // The masthead kicker: smallCaps. A keystroke elsewhere triggers a full
    // body read-back; the DOM read-back of THIS unchanged block dropped
    // smallCaps — preservation must keep the previous runs since the text
    // didn't change.
    const prev: Block[] = [para("Field Almanac", { smallCaps: true })];
    const next: Block[] = [para("Field Almanac", {})]; // re-read lost smallCaps
    const [p] = mergeReadbackPreservingProps(prev, next) as [Paragraph];
    expect(p.runs[0]!.properties).toEqual({ smallCaps: true });
  });

  it("takes the re-read runs when the text actually changed", () => {
    const prev: Block[] = [para("hello", { bold: true })];
    const next: Block[] = [para("hello world", {})];
    const [p] = mergeReadbackPreservingProps(prev, next) as [Paragraph];
    const run = p.runs[0] as { kind: "text"; text: string };
    expect(run.text).toBe("hello world");
  });
});
