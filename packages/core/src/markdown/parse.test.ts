import { describe, expect, it } from "vitest";
import type { HyperlinkRun, Paragraph, TextRun } from "../doc/types";
import { parseMarkdown } from "./parse";

function paraAt(doc: ReturnType<typeof parseMarkdown>, i: number): Paragraph {
  const block = doc.body[i];
  if (!block || block.kind !== "paragraph") {
    throw new Error(`expected paragraph at ${i}, got ${block?.kind}`);
  }
  return block;
}

function plainText(p: Paragraph): string {
  return p.runs
    .map((r) => {
      if (r.kind === "text") return r.text;
      if (r.kind === "hyperlink") {
        return r.children.map((c) => (c.kind === "text" ? c.text : "")).join("");
      }
      return "";
    })
    .join("");
}

describe("parseMarkdown", () => {
  it("returns at least one paragraph for empty input", () => {
    const doc = parseMarkdown("");
    expect(doc.body.length).toBeGreaterThanOrEqual(1);
    expect(doc.body[0]?.kind).toBe("paragraph");
  });

  it("parses ATX headings with style ids", () => {
    const doc = parseMarkdown("# H1\n## H2\n###### H6");
    expect(doc.body).toHaveLength(3);
    const headings = doc.body.map((b) => {
      if (b.kind !== "paragraph") throw new Error("expected paragraph");
      return b.properties.styleId;
    });
    expect(headings).toEqual(["Heading1", "Heading2", "Heading6"]);
  });

  it("treats blank lines as paragraph separators", () => {
    const doc = parseMarkdown("First.\n\nSecond.\n\nThird.");
    expect(doc.body).toHaveLength(3);
    expect(plainText(paraAt(doc, 0))).toBe("First.");
    expect(plainText(paraAt(doc, 1))).toBe("Second.");
    expect(plainText(paraAt(doc, 2))).toBe("Third.");
  });

  it("joins multi-line paragraphs with a space", () => {
    const doc = parseMarkdown("line one\nline two\nline three");
    expect(doc.body).toHaveLength(1);
    expect(plainText(paraAt(doc, 0))).toBe("line one line two line three");
  });

  it("respects two-space hard line breaks", () => {
    const doc = parseMarkdown("line one  \nline two");
    expect(doc.body).toHaveLength(1);
    const p = paraAt(doc, 0);
    const kinds = p.runs.map((r) => r.kind);
    expect(kinds).toContain("break");
  });

  it("parses bold and italic markers", () => {
    const doc = parseMarkdown("This is **bold** and *italic* and _also italic_.");
    const p = paraAt(doc, 0);
    const bold = p.runs.find((r) => r.kind === "text" && (r as TextRun).properties.bold) as
      | TextRun
      | undefined;
    const italics = p.runs.filter((r) => r.kind === "text" && (r as TextRun).properties.italic);
    expect(bold?.text).toBe("bold");
    expect(italics).toHaveLength(2);
    expect((italics[0] as TextRun).text).toBe("italic");
    expect((italics[1] as TextRun).text).toBe("also italic");
  });

  it("parses inline code with monospace fontFamily", () => {
    const doc = parseMarkdown("Run `npm install` to start.");
    const p = paraAt(doc, 0);
    const code = p.runs.find((r) => r.kind === "text" && (r as TextRun).properties.fontFamily) as
      | TextRun
      | undefined;
    expect(code?.text).toBe("npm install");
  });

  it("parses inline links", () => {
    const doc = parseMarkdown("Visit [Sobree](https://sobree.dev) today.");
    const p = paraAt(doc, 0);
    const link = p.runs.find((r) => r.kind === "hyperlink") as HyperlinkRun | undefined;
    expect(link?.href).toBe("https://sobree.dev");
    const linkText = link?.children.map((c) => (c.kind === "text" ? c.text : "")).join("");
    expect(linkText).toBe("Sobree");
  });

  it("parses bulleted lists with one numbering definition", () => {
    const doc = parseMarkdown("- one\n- two\n- three");
    expect(doc.body).toHaveLength(3);
    expect(doc.numbering).toHaveLength(1);
    expect(doc.numbering[0]?.abstractFormat.levels[0]?.format).toBe("bullet");
    for (const block of doc.body) {
      if (block.kind !== "paragraph") throw new Error("expected paragraph");
      expect(block.properties.numbering?.numId).toBe(doc.numbering[0]?.numId);
    }
  });

  it("parses numbered lists with one decimal definition", () => {
    const doc = parseMarkdown("1. one\n2. two\n3. three");
    expect(doc.body).toHaveLength(3);
    expect(doc.numbering).toHaveLength(1);
    expect(doc.numbering[0]?.abstractFormat.levels[0]?.format).toBe("decimal");
  });

  it("starts a new list when kind switches", () => {
    const doc = parseMarkdown("- bullet\n\n1. number");
    expect(doc.numbering).toHaveLength(2);
    expect(doc.numbering[0]?.abstractFormat.levels[0]?.format).toBe("bullet");
    expect(doc.numbering[1]?.abstractFormat.levels[0]?.format).toBe("decimal");
  });

  it("falls through unsupported syntax as plain text", () => {
    const doc = parseMarkdown("> not a quote, just text\n```not a fence```");
    expect(doc.body.length).toBeGreaterThanOrEqual(1);
    // Lines join with space; just confirm text is preserved.
    const all = doc.body
      .filter((b) => b.kind === "paragraph")
      .map((b) => plainText(b as Paragraph))
      .join(" ");
    expect(all).toContain("not a quote");
    expect(all).toContain("not a fence");
  });

  it("handles a multi-block document end-to-end", () => {
    const md = `# Q2 brief

Body paragraph with **bold** and a [link](https://example.com).

- alpha
- beta

## Next steps

1. Plan
2. Ship`;
    const doc = parseMarkdown(md);
    const kinds = doc.body.map((b) =>
      b.kind === "paragraph" ? (b.properties.styleId ?? "para") : b.kind,
    );
    expect(kinds[0]).toBe("Heading1");
    expect(kinds[1]).toBe("para");
    expect(kinds[2]).toBe("para"); // alpha (numbered/bulleted but kind="paragraph")
    expect(kinds[3]).toBe("para"); // beta
    expect(kinds[4]).toBe("Heading2");
    expect(kinds[5]).toBe("para"); // 1. Plan
    expect(kinds[6]).toBe("para"); // 2. Ship
    expect(doc.numbering.length).toBe(2);
  });
});
