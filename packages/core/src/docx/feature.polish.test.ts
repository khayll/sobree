import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../doc/builders";
import type { HyperlinkRun, Paragraph, Table, TableCell } from "../doc/types";
import { exportDocx } from "./export/index";
import { importDocx } from "./import/index";

describe("Hyperlinks round-trip", () => {
  it("preserves a hyperlink's URL through docx export → import", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([
        text("see "),
        {
          kind: "hyperlink",
          href: "https://example.com/about",
          children: [{ kind: "text", text: "the docs", properties: {} }],
        } as HyperlinkRun,
        text(" for more"),
      ]),
    ];
    const { bytes } = exportDocx(doc);
    const { document: imported } = await importDocx(bytes);
    const para = imported.body.find((b): b is Paragraph => b.kind === "paragraph");
    const link = para?.runs.find((r) => r.kind === "hyperlink") as HyperlinkRun | undefined;
    expect(link?.href).toBe("https://example.com/about");
    const inner = link?.children[0];
    expect(inner?.kind === "text" && inner.text).toBe("the docs");
  });
});

describe("Multi-paragraph table cells", () => {
  it("renders multi-paragraph cells as separate <p> children and round-trips them", async () => {
    const { renderSobreeDocument } = await import("../editor/view/docRenderer/index");
    const { serializeHostsToDocument } = await import("../editor/view/docSerialize/index");

    const cell: TableCell = {
      content: [paragraph([text("first")]), paragraph([text("second")])],
    };
    const table: Table = {
      kind: "table",
      grid: [2400],
      rows: [{ cells: [cell] }],
      properties: {},
    };
    const doc = emptyDocument();
    doc.body = [table];

    const host = document.createElement("div");
    renderSobreeDocument(doc, host);
    // Modern rendering: each paragraph in a cell becomes its own <p>
    // (instead of <br>-separated inline content), so per-paragraph
    // properties — line-height, before/after spacing, indent — flow
    // through the cascade. The <br>-separated form is still accepted
    // on the serialize side for backward-compat with pre-fix content
    // (see the legacy test below).
    expect(host.querySelectorAll("td > p")).toHaveLength(2);

    const back = serializeHostsToDocument([host]);
    const importedTable = back.body.find((b): b is Table => b.kind === "table");
    const cellContent = importedTable?.rows[0]?.cells[0]?.content;
    expect(cellContent).toHaveLength(2);
    const firstPara = cellContent?.[0] as Paragraph;
    const secondPara = cellContent?.[1] as Paragraph;
    expect((firstPara.runs[0] as { text: string }).text).toBe("first");
    expect((secondPara.runs[0] as { text: string }).text).toBe("second");
  });

  it("still serialises legacy <br>-separated cell content into multiple Paragraphs", async () => {
    // Backward-compat path: cells that someone pasted/edited without
    // the modern <p> wrapper still need to round-trip via the <br>
    // splitter. Hand-crafted DOM here mirrors the old render output.
    const { serializeHostsToDocument } = await import("../editor/view/docSerialize/index");
    const host = document.createElement("div");
    host.innerHTML = "<table><tbody><tr><td>first<br>second</td></tr></tbody></table>";
    const back = serializeHostsToDocument([host]);
    const importedTable = back.body.find((b): b is Table => b.kind === "table");
    const cellContent = importedTable?.rows[0]?.cells[0]?.content;
    expect(cellContent).toHaveLength(2);
    expect(((cellContent?.[0] as Paragraph).runs[0] as { text: string }).text).toBe("first");
    expect(((cellContent?.[1] as Paragraph).runs[0] as { text: string }).text).toBe("second");
  });
});

describe("Image dimensions read from inline styles", () => {
  it("serialise preserves <img style='width/height'> into DrawingRun EMU", async () => {
    const { serializeHostsToDocument } = await import("../editor/view/docSerialize/index");
    const host = document.createElement("div");
    host.innerHTML = `
      <p>
        before
        <img data-part="word/media/image1.png" style="width:96px;height:48px" alt="test"/>
        after
      </p>
    `;
    const doc = serializeHostsToDocument([host]);
    const para = doc.body.find((b): b is Paragraph => b.kind === "paragraph");
    const drawing = para?.runs.find((r) => r.kind === "drawing");
    if (drawing?.kind !== "drawing") throw new Error("no drawing");
    // 96 px = 1 inch = 914400 EMU; 48 px = 0.5 inch = 457200 EMU
    expect(drawing.widthEmu).toBe(914400);
    expect(drawing.heightEmu).toBe(457200);
  });
});
