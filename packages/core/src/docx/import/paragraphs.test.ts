import { describe, expect, it } from "vitest";
import { readParagraph } from "./paragraphs";

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/**
 * Body-paragraph importer regression coverage. Pairs with `styles.test`
 * for the style-cascade side of the same fields — both code paths
 * call `readShading` from `../shared/shading`, but the wiring
 * (`ParagraphFormat` → `mapParagraphFormat` → `ParagraphProperties`)
 * lives on the body side and needs its own lock.
 */
describe("readParagraph — tracked changes", () => {
  it("tags runs inside <w:ins> with revision marker", () => {
    const doc = new DOMParser().parseFromString(
      `<?xml version="1.0"?><w:p xmlns:w="${NS_W}">
        <w:r><w:t>plain</w:t></w:r>
        <w:ins w:id="1" w:author="Alice" w:date="2026-05-21T10:00:00Z">
          <w:r><w:t>inserted</w:t></w:r>
        </w:ins>
      </w:p>`,
      "application/xml",
    );
    const { items } = readParagraph(doc.documentElement);
    expect(items).toHaveLength(2);
    expect((items[0] as { run: { revision?: unknown } }).run.revision).toBeUndefined();
    const insRun = (items[1] as { run: { revision?: unknown; text: string } }).run;
    expect(insRun.text).toBe("inserted");
    expect(insRun.revision).toEqual({ type: "ins", author: "Alice", date: "2026-05-21T10:00:00Z" });
  });

  it("tags runs inside <w:del> with revision + reads <w:delText>", () => {
    const doc = new DOMParser().parseFromString(
      `<?xml version="1.0"?><w:p xmlns:w="${NS_W}">
        <w:del w:id="2" w:author="Bob">
          <w:r><w:delText>removed text</w:delText></w:r>
        </w:del>
      </w:p>`,
      "application/xml",
    );
    const { items } = readParagraph(doc.documentElement);
    expect(items).toHaveLength(1);
    const delRun = (items[0] as { run: { revision?: unknown; text: string } }).run;
    expect(delRun.text).toBe("removed text");
    expect(delRun.revision).toEqual({ type: "del", author: "Bob" });
  });

  it("inner ins/del nesting takes the inner marker", () => {
    const doc = new DOMParser().parseFromString(
      `<?xml version="1.0"?><w:p xmlns:w="${NS_W}">
        <w:ins w:id="1" w:author="Alice">
          <w:del w:id="2" w:author="Bob">
            <w:r><w:delText>contested word</w:delText></w:r>
          </w:del>
        </w:ins>
      </w:p>`,
      "application/xml",
    );
    const { items } = readParagraph(doc.documentElement);
    const innerRun = (items[0] as { run: { revision?: unknown } }).run;
    expect(innerRun.revision).toEqual({ type: "del", author: "Bob" });
  });
});

describe("readParagraph", () => {
  const styled = (val: string) =>
    readParagraph(
      new DOMParser().parseFromString(
        `<?xml version="1.0"?><w:p xmlns:w="${NS_W}"><w:pPr><w:pStyle w:val="${val}"/></w:pPr></w:p>`,
        "application/xml",
      ).documentElement,
    ).format;

  it("canonicalises heading styles to a heading level", () => {
    expect(styled("Heading1").headingLevel).toBe(1);
    expect(styled("Heading3").headingLevel).toBe(3);
    // OpenOffice's lowercase-with-space export.
    expect(styled("heading 2").headingLevel).toBe(2);
  });

  it("does NOT treat `Title` as a heading — it keeps its own style", () => {
    // `Title` is a distinct Word style with its own display font; mapping
    // it to `Heading1` would discard that. It must stay `Title` so the
    // renderer's cascade applies the real Title formatting.
    const f = styled("Title");
    expect(f.headingLevel).toBeUndefined();
    expect(f.styleId).toBe("Title");
  });

  it("reads <w:numPr> into numId / numLevel", () => {
    const doc = new DOMParser().parseFromString(
      `<?xml version="1.0"?><w:p xmlns:w="${NS_W}"><w:pPr>
         <w:numPr><w:ilvl w:val="2"/><w:numId w:val="7"/></w:numPr>
       </w:pPr></w:p>`,
      "application/xml",
    );
    const f = readParagraph(doc.documentElement).format;
    expect(f.numId).toBe(7);
    expect(f.numLevel).toBe(2);
  });

  it('treats <w:numId w:val="0"> as no numbering (the cancel-list sentinel)', () => {
    // numId 0 cancels a list the paragraph style would inherit — it is
    // NOT a real list, so it must not produce numbering on the AST.
    const doc = new DOMParser().parseFromString(
      `<?xml version="1.0"?><w:p xmlns:w="${NS_W}"><w:pPr>
         <w:pStyle w:val="BulletedList"/>
         <w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>
       </w:pPr></w:p>`,
      "application/xml",
    );
    const f = readParagraph(doc.documentElement).format;
    expect(f.numId).toBeUndefined();
    expect(f.numLevel).toBeUndefined();
  });

  it("reads <w:pPr><w:shd> into format.shading", () => {
    const doc = new DOMParser().parseFromString(
      `<?xml version="1.0"?><w:p xmlns:w="${NS_W}">
        <w:pPr>
          <w:shd w:val="clear" w:fill="C6EFCE"/>
        </w:pPr>
        <w:r><w:t>shaded</w:t></w:r>
      </w:p>`,
      "application/xml",
    );
    const p = doc.documentElement;
    const parsed = readParagraph(p);
    expect(parsed.format.shading).toEqual({ pattern: "clear", fill: "#C6EFCE" });
  });

  it("omits shading when <w:shd> has fill=auto", () => {
    const doc = new DOMParser().parseFromString(
      `<?xml version="1.0"?><w:p xmlns:w="${NS_W}">
        <w:pPr>
          <w:shd w:val="clear" w:fill="auto"/>
        </w:pPr>
      </w:p>`,
      "application/xml",
    );
    const parsed = readParagraph(doc.documentElement);
    expect(parsed.format.shading).toBeUndefined();
  });

  it("carries shading color when present and not auto", () => {
    const doc = new DOMParser().parseFromString(
      `<?xml version="1.0"?><w:p xmlns:w="${NS_W}">
        <w:pPr>
          <w:shd w:val="pct25" w:fill="EEEEEE" w:color="333333"/>
        </w:pPr>
      </w:p>`,
      "application/xml",
    );
    const parsed = readParagraph(doc.documentElement);
    expect(parsed.format.shading).toEqual({
      pattern: "pct25",
      fill: "#EEEEEE",
      color: "#333333",
    });
  });
});

describe("readParagraph — HYPERLINK fields", () => {
  const parse = (inner: string) =>
    readParagraph(
      new DOMParser().parseFromString(
        `<?xml version="1.0"?><w:p xmlns:w="${NS_W}">${inner}</w:p>`,
        "application/xml",
      ).documentElement,
    ).items;

  const field = (instr: string, result: string) => `
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText>${instr}</w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="separate"/></w:r>
    ${result}
    <w:r><w:fldChar w:fldCharType="end"/></w:r>`;

  it("normalises a HYPERLINK field to a hyperlink item with styled result runs", () => {
    const items = parse(
      field(
        ' HYPERLINK "mailto:a@b.c" ',
        `<w:r><w:rPr><w:rStyle w:val="Hyperlink.0"/></w:rPr><w:t>a@b.c</w:t></w:r>`,
      ),
    );
    expect(items).toHaveLength(1);
    const link = items[0] as {
      kind: string;
      href?: string;
      runs: Array<{ text: string; format: { styleId?: string } }>;
    };
    expect(link.kind).toBe("hyperlink");
    expect(link.href).toBe("mailto:a@b.c");
    expect(link.runs[0]?.text).toBe("a@b.c");
    // The result run keeps its character style — the link's underline /
    // colour come from it, not from UA anchor defaults.
    expect(link.runs[0]?.format.styleId).toBe("Hyperlink.0");
  });

  it("resolves \\l bookmark targets to fragment hrefs", () => {
    const items = parse(field(' HYPERLINK \\l "sec1" ', "<w:r><w:t>see §1</w:t></w:r>"));
    expect((items[0] as { href?: string }).href).toBe("#sec1");
  });

  it("leaves PAGE fields as FieldRun (live per-page substitution)", () => {
    const items = parse(field(" PAGE ", "<w:r><w:t>3</w:t></w:r>"));
    const run = (items[0] as { run: { field?: { instruction: string; cached?: string } } }).run;
    expect(run.field).toEqual({ instruction: "PAGE", cached: "3" });
  });
});
