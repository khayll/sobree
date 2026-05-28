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
