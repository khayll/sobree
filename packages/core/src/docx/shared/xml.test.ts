import { describe, expect, it } from "vitest";
import { NS } from "./namespaces";
import {
  el,
  escapeXmlText,
  parseXml,
  serializeXml,
  wAll,
  wChildren,
  wFirst,
  wVal,
  xmlDocument,
} from "./xml";

const sample = `<?xml version="1.0"?>
<w:p xmlns:w="${NS.w}">
  <w:pPr><w:jc w:val="center"/></w:pPr>
  <w:r><w:t>hi</w:t></w:r>
  <w:r><w:t>there</w:t></w:r>
</w:p>`;

describe("parseXml / serializeXml", () => {
  it("parses well-formed XML into a Document", () => {
    const doc = parseXml(sample);
    expect(doc.documentElement.localName).toBe("p");
    expect(doc.documentElement.namespaceURI).toBe(NS.w);
  });

  it("throws on malformed XML", () => {
    expect(() => parseXml("<w:p><unclosed></w:p>")).toThrow(/XML parse failed/);
  });

  it("round-trips through serializeXml", () => {
    const doc = parseXml(sample);
    const t = wFirst(doc, "t");
    expect(t).not.toBeNull();
    expect(serializeXml(t!)).toContain("hi");
  });
});

describe("wFirst / wAll / wChildren / wVal", () => {
  const doc = parseXml(sample);

  it("wFirst returns the first matching descendant", () => {
    const t = wFirst(doc, "t");
    expect(t?.textContent).toBe("hi");
  });

  it("wFirst returns null when absent", () => {
    expect(wFirst(doc, "tbl")).toBeNull();
  });

  it("wAll returns every matching descendant", () => {
    const ts = wAll(doc, "t");
    expect(ts.map((n) => n.textContent)).toEqual(["hi", "there"]);
    expect(wAll(doc, "r")).toHaveLength(2);
  });

  it("wChildren returns only direct children in the w namespace", () => {
    const p = doc.documentElement;
    // direct children of <w:p> are pPr + two <w:r>; no <w:t> directly.
    expect(wChildren(p, "r")).toHaveLength(2);
    expect(wChildren(p, "t")).toHaveLength(0);
    expect(wChildren(p, "pPr")).toHaveLength(1);
  });

  it("wVal reads a w:val attribute", () => {
    const jc = wFirst(doc, "jc");
    expect(wVal(jc)).toBe("center");
  });

  it("wVal returns null for null input or missing attribute", () => {
    expect(wVal(null)).toBeNull();
    expect(wVal(wFirst(doc, "r"))).toBeNull();
  });
});

describe("el", () => {
  it("builds a self-closing element with no children", () => {
    expect(el("w:jc", { "w:val": "center" })).toBe('<w:jc w:val="center"/>');
  });

  it("builds an empty self-closing element with no attrs", () => {
    expect(el("w:br")).toBe("<w:br/>");
  });

  it("wraps string children", () => {
    expect(el("w:t", null, "hi")).toBe("<w:t>hi</w:t>");
  });

  it("joins array children in order", () => {
    expect(el("w:r", null, [el("w:t", null, "a"), el("w:t", null, "b")])).toBe(
      "<w:r><w:t>a</w:t><w:t>b</w:t></w:r>",
    );
  });

  it("renders attributes in insertion order and skips undefined values", () => {
    expect(el("w:p", { a: "1", b: undefined, c: 2 })).toBe('<w:p a="1" c="2"/>');
  });

  it("treats an empty array as no children (self-closing)", () => {
    expect(el("w:p", null, [])).toBe("<w:p/>");
  });

  it("escapes attribute values", () => {
    expect(el("w:t", { x: 'a&b<"c"' })).toBe('<w:t x="a&amp;b&lt;&quot;c&quot;"/>');
  });
});

describe("escapeXmlText", () => {
  it("escapes &, < and >", () => {
    expect(escapeXmlText("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });

  it("escapes & before < and > (no double-escaping)", () => {
    expect(escapeXmlText("<&>")).toBe("&lt;&amp;&gt;");
  });

  it("leaves plain text untouched", () => {
    expect(escapeXmlText("hello world")).toBe("hello world");
  });
});

describe("xmlDocument", () => {
  it("prepends the XML declaration to the root markup", () => {
    const out = xmlDocument("<w:document/>");
    expect(out).toBe('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document/>');
  });
});
