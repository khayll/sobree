import { appendBlock, emptyDocument, heading, paragraph, text } from "../../doc/builders";
import type { Paragraph, SobreeDocument, Table, TextRun } from "../../doc/types";
import { renderSobreeDocument } from "./docRenderer/index";
import { serializeHostsToDocument } from "./docSerialize/index";
import { describe, expect, it } from "vitest";

function roundTrip(doc: SobreeDocument): SobreeDocument {
  const host = document.createElement("div");
  renderSobreeDocument(doc, host);
  return serializeHostsToDocument([host]);
}

function makeDoc(blocks: Paragraph[]): SobreeDocument {
  const d = emptyDocument();
  d.body = blocks;
  return d;
}

describe("SobreeDocument render ↔ serialize (Phase N3)", () => {
  it("round-trips plain text paragraphs", () => {
    const doc = makeDoc([paragraph([text("Hello world.")])]);
    const back = roundTrip(doc);
    expect(back.body).toHaveLength(1);
    const run = (back.body[0] as Paragraph).runs[0];
    expect(run).toMatchObject({ kind: "text", text: "Hello world." });
  });

  it("preserves heading levels through <h1>..<h6>", () => {
    const doc = emptyDocument();
    doc.body = [];
    for (let lv = 1; lv <= 6; lv++) appendBlock(doc, heading(lv, [text(`H${lv}`)]));
    const back = roundTrip(doc);
    for (let lv = 1; lv <= 6; lv++) {
      const p = back.body[lv - 1] as Paragraph;
      expect(p.properties.styleId).toBe(`Heading${lv}`);
    }
  });

  it("flattens nested wrappers (strong+italic) into one TextRun", () => {
    const doc = makeDoc([
      paragraph([
        text("normal "),
        {
          kind: "text",
          text: "bold italic",
          properties: { bold: true, italic: true },
        } as TextRun,
      ]),
    ]);
    const back = roundTrip(doc);
    const p = back.body[0] as Paragraph;
    expect(p.runs).toHaveLength(2);
    expect(p.runs[1]).toMatchObject({
      kind: "text",
      text: "bold italic",
      properties: { bold: true, italic: true },
    });
  });

  it("preserves color / font-family / font-size via inline style", () => {
    const doc = makeDoc([
      paragraph([
        {
          kind: "text",
          text: "fancy",
          properties: { color: "#ff0000", fontFamily: "Georgia", fontSizePt: 14 },
        } as TextRun,
      ]),
    ]);
    const back = roundTrip(doc);
    const run = (back.body[0] as Paragraph).runs[0] as TextRun;
    expect(run.properties.color?.toLowerCase()).toBe("#ff0000");
    expect(run.properties.fontFamily).toBe("Georgia");
    expect(run.properties.fontSizePt).toBe(14);
  });

  it("preserves subscript and superscript", () => {
    const doc = makeDoc([
      paragraph([
        text("H"),
        { kind: "text", text: "2", properties: { verticalAlign: "subscript" } } as TextRun,
        text("O, E=mc"),
        { kind: "text", text: "2", properties: { verticalAlign: "superscript" } } as TextRun,
      ]),
    ]);
    const back = roundTrip(doc);
    const runs = (back.body[0] as Paragraph).runs as TextRun[];
    expect(runs.find((r) => r.properties.verticalAlign === "subscript")?.text).toBe("2");
    expect(runs.find((r) => r.properties.verticalAlign === "superscript")?.text).toBe("2");
  });

  it("preserves alignment on paragraphs", () => {
    const p = paragraph([text("centred")]);
    p.properties.alignment = "center";
    const back = roundTrip(makeDoc([p]));
    expect((back.body[0] as Paragraph).properties.alignment).toBe("center");
  });

  it("round-trips hard line breaks inside a paragraph", () => {
    const doc = makeDoc([
      paragraph([text("line 1"), { kind: "break", type: "line" }, text("line 2")]),
    ]);
    const back = roundTrip(doc);
    const runs = (back.body[0] as Paragraph).runs;
    expect(runs.find((r) => r.kind === "break")).toBeDefined();
    expect(runs[0]).toMatchObject({ kind: "text", text: "line 1" });
    expect(runs[runs.length - 1]).toMatchObject({ kind: "text", text: "line 2" });
  });

  it("groups consecutive numbered paragraphs into <ol> / <ul>", () => {
    const doc = emptyDocument();
    doc.body = [];
    doc.numbering = [
      {
        numId: 1,
        abstractFormat: { levels: [{ level: 0, format: "decimal", text: "%1." }] },
      },
    ];
    const item = (s: string): Paragraph => ({
      kind: "paragraph",
      properties: { numbering: { numId: 1, level: 0 } },
      runs: [{ kind: "text", text: s, properties: {} }],
    });
    doc.body = [item("alpha"), item("beta"), item("gamma")];

    const host = document.createElement("div");
    renderSobreeDocument(doc, host);
    expect(host.querySelector("ol")).not.toBeNull();
    expect(host.querySelectorAll("ol > li")).toHaveLength(3);

    const back = serializeHostsToDocument([host]);
    expect(back.body).toHaveLength(3);
    for (const block of back.body) {
      expect((block as Paragraph).properties.numbering).toBeDefined();
    }
  });

  it("round-trips tables with aligned cells", () => {
    const table: Table = {
      kind: "table",
      grid: [2400, 2400],
      rows: [
        {
          isHeader: true,
          cells: [
            {
              content: [
                {
                  kind: "paragraph",
                  properties: { alignment: "center" },
                  runs: [{ kind: "text", text: "Name", properties: { bold: true } }],
                },
              ],
            },
            {
              content: [
                {
                  kind: "paragraph",
                  properties: { alignment: "right" },
                  runs: [{ kind: "text", text: "Torque", properties: { bold: true } }],
                },
              ],
            },
          ],
        },
        {
          cells: [
            {
              content: [
                {
                  kind: "paragraph",
                  properties: {},
                  runs: [{ kind: "text", text: "Flange", properties: {} }],
                },
              ],
            },
            {
              content: [
                {
                  kind: "paragraph",
                  properties: { alignment: "right" },
                  runs: [{ kind: "text", text: "42", properties: {} }],
                },
              ],
            },
          ],
        },
      ],
      properties: {},
    };
    const doc = emptyDocument();
    doc.body = [table];
    const back = roundTrip(doc);
    const backTable = back.body[0] as Table;
    expect(backTable.kind).toBe("table");
    expect(backTable.rows).toHaveLength(2);
    expect(backTable.rows[0]?.isHeader).toBe(true);
    expect(backTable.rows[0]?.cells[1]?.content[0]).toMatchObject({
      kind: "paragraph",
      properties: { alignment: "right" },
    });
  });
});
