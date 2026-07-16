import { describe, expect, it } from "vitest";

import type { Paragraph, Table, TextRun } from "../../doc/types";
import { parseClipboardHtml } from "./pasteHtml";

function runsOf(b: Paragraph): TextRun[] {
  return b.runs.filter((r): r is TextRun => r.kind === "text");
}

describe("parseClipboardHtml", () => {
  it("parses a plain paragraph", () => {
    const { blocks } = parseClipboardHtml("<p>Hello world</p>");
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as Paragraph).kind).toBe("paragraph");
    expect(runsOf(blocks[0] as Paragraph)[0]!.text).toBe("Hello world");
  });

  it("keeps inline formatting (bold / italic / underline / link)", () => {
    const { blocks } = parseClipboardHtml(
      "<p>a <b>bold</b> <i>it</i> <u>un</u> <a href='https://x.com'>lnk</a></p>",
    );
    const p = blocks[0] as Paragraph;
    const bold = p.runs.find((r) => r.kind === "text" && r.text === "bold") as TextRun;
    expect(bold.properties.bold).toBe(true);
    expect(
      (p.runs.find((r) => r.kind === "text" && r.text === "it") as TextRun).properties.italic,
    ).toBe(true);
    expect(
      (p.runs.find((r) => r.kind === "text" && r.text === "un") as TextRun).properties.underline,
    ).toBe("single");
    const link = p.runs.find((r) => r.kind === "hyperlink");
    expect(link).toBeDefined();
  });

  it("parses inline CSS from span[style] (color / font-size / weight)", () => {
    const { blocks } = parseClipboardHtml(
      "<p><span style='color:#ff0000;font-size:18pt;font-weight:bold'>red</span></p>",
    );
    const run = runsOf(blocks[0] as Paragraph)[0]!;
    expect(run.properties.color).toBe("#ff0000");
    expect(run.properties.fontSizePt).toBe(18);
    expect(run.properties.bold).toBe(true);
  });

  it("keeps inline CSS carried on a SEMANTIC tag, not just a span", () => {
    // Chrome's clipboard HTML inlines computed styles onto whatever element it
    // copied — for text inside `<strong>`, that's the <strong> itself. Dropping
    // its style attr loses colour/small-caps on paste (the reported bug: copying
    // an orange small-caps word and pasting it back rendered plain black bold).
    const { blocks } = parseClipboardHtml(
      "<meta charset='utf-8'><strong style=\"color:#F2A900;font-size:11pt;font-variant-caps:small-caps\">almanac</strong>",
    );
    const run = runsOf(blocks[0] as Paragraph)[0]!;
    expect(run.properties.bold).toBe(true);
    expect(run.properties.color).toBe("#F2A900");
    expect(run.properties.smallCaps).toBe(true);
    expect(run.properties.fontSizePt).toBe(11);
  });

  it("keeps inline CSS on other semantic tags (em / u)", () => {
    const { blocks } = parseClipboardHtml(
      "<p><em style='color:#112233'>a</em><u style='font-size:9pt'>b</u></p>",
    );
    const p = blocks[0] as Paragraph;
    const a = p.runs.find((r) => r.kind === "text" && r.text === "a") as TextRun;
    const b = p.runs.find((r) => r.kind === "text" && r.text === "b") as TextRun;
    expect(a.properties.italic).toBe(true);
    expect(a.properties.color).toBe("#112233");
    expect(b.properties.underline).toBe("single");
    expect(b.properties.fontSizePt).toBe(9);
  });

  it("maps headings to Heading styles", () => {
    const { blocks } = parseClipboardHtml("<h1>Title</h1><h3>Sub</h3>");
    expect((blocks[0] as Paragraph).properties.styleId).toBe("Heading1");
    expect((blocks[1] as Paragraph).properties.styleId).toBe("Heading3");
  });

  it("parses a list into numbered paragraphs + numbering def", () => {
    const { blocks, numbering } = parseClipboardHtml("<ul><li>one</li><li>two</li></ul>");
    expect(blocks).toHaveLength(2);
    expect((blocks[0] as Paragraph).properties.numbering).toBeDefined();
    expect(numbering).toHaveLength(1);
    expect(runsOf(blocks[1] as Paragraph)[0]!.text).toBe("two");
  });

  it("groups loose inline siblings into a single paragraph", () => {
    // No wrapping <p> — text + inline elements at the top level.
    const { blocks } = parseClipboardHtml("plain <b>bold</b> more");
    expect(blocks).toHaveLength(1);
    const p = blocks[0] as Paragraph;
    expect(p.runs.map((r) => (r.kind === "text" ? r.text : "")).join("")).toBe("plain bold more");
  });

  it("recurses into wrapper divs (Google-Docs-style nesting)", () => {
    const { blocks } = parseClipboardHtml(
      "<div><div><p>first</p><p>second</p></div><p>third</p></div>",
    );
    expect(blocks).toHaveLength(3);
    expect(runsOf(blocks[0] as Paragraph)[0]!.text).toBe("first");
    expect(runsOf(blocks[2] as Paragraph)[0]!.text).toBe("third");
  });

  it("treats a <div> of inline content as one paragraph", () => {
    const { blocks } = parseClipboardHtml("<div>a<span>b</span>c</div>");
    expect(blocks).toHaveLength(1);
    expect(
      (blocks[0] as Paragraph).runs.map((r) => (r.kind === "text" ? r.text : "")).join(""),
    ).toBe("abc");
  });

  it("parses a table", () => {
    const { blocks } = parseClipboardHtml(
      "<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>",
    );
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as Table).kind).toBe("table");
    expect((blocks[0] as Table).rows).toHaveLength(2);
  });

  it("drops empty whitespace-only wrappers", () => {
    const { blocks } = parseClipboardHtml("<p>real</p><div>   </div>\n  <p>content</p>");
    const texts = blocks.map((b) =>
      (b as Paragraph).runs.map((r) => (r.kind === "text" ? r.text : "")).join(""),
    );
    expect(texts.filter((t) => t.trim() !== "")).toEqual(["real", "content"]);
  });
});
