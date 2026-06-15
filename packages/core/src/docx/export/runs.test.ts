import { describe, expect, it } from "vitest";
import { emptyDocument } from "../../doc/builders";
import type { InlineRun, SobreeDocument } from "../../doc/types";
import { NS } from "../shared/namespaces";
import { parseXml, wVal } from "../shared/xml";
import { makeExportContext } from "./context";
import { inlinesToRuns } from "./runs";

/**
 * `inlinesToRuns` emits a bare XML fragment (no root). Wrap it in a
 * namespaced root so it can be parsed and queried with the w: namespace.
 */
function parseRuns(fragment: string): Document {
  return parseXml(`<w:root xmlns:w="${NS.w}" xmlns:r="${NS.r}">${fragment}</w:root>`);
}

function render(inlines: InlineRun[], doc: SobreeDocument = emptyDocument()): Document {
  return parseRuns(inlinesToRuns(inlines, makeExportContext(2), doc));
}

describe("inlinesToRuns", () => {
  it("renders a plain text run as <w:r><w:t>", () => {
    const doc = render([{ kind: "text", text: "hello", properties: {} }]);
    const runs = doc.getElementsByTagNameNS(NS.w, "r");
    expect(runs).toHaveLength(1);
    const t = doc.getElementsByTagNameNS(NS.w, "t")[0]!;
    expect(t.textContent).toBe("hello");
    expect(t.getAttribute("xml:space")).toBe("preserve");
  });

  it("emits <w:b> for a bold run inside <w:rPr>", () => {
    const doc = render([{ kind: "text", text: "bold", properties: { bold: true } }]);
    const rPr = doc.getElementsByTagNameNS(NS.w, "rPr")[0]!;
    expect(rPr.getElementsByTagNameNS(NS.w, "b")).toHaveLength(1);
  });

  it("emits no <w:rPr> for an unstyled run", () => {
    const doc = render([{ kind: "text", text: "plain", properties: {} }]);
    expect(doc.getElementsByTagNameNS(NS.w, "rPr")).toHaveLength(0);
  });

  it("escapes XML-special characters in text", () => {
    const doc = render([{ kind: "text", text: "a < b & c", properties: {} }]);
    const t = doc.getElementsByTagNameNS(NS.w, "t")[0]!;
    expect(t.textContent).toBe("a < b & c");
  });

  it("renders a soft line break as a bare <w:br>", () => {
    const doc = render([{ kind: "break", type: "line" }]);
    const br = doc.getElementsByTagNameNS(NS.w, "br")[0]!;
    expect(br).toBeDefined();
    expect(br.getAttributeNS(NS.w, "type")).toBeNull();
  });

  it("renders a page break with w:type=page", () => {
    const doc = render([{ kind: "break", type: "page" }]);
    const br = doc.getElementsByTagNameNS(NS.w, "br")[0]!;
    expect(br.getAttributeNS(NS.w, "type")).toBe("page");
  });

  it("renders a tab run as <w:tab>", () => {
    const doc = render([{ kind: "tab" }]);
    expect(doc.getElementsByTagNameNS(NS.w, "tab")).toHaveLength(1);
  });

  it("renders a field run as <w:fldSimple> with padded instruction", () => {
    const doc = render([{ kind: "field", instruction: "PAGE", cached: "1" }]);
    const fld = doc.getElementsByTagNameNS(NS.w, "fldSimple")[0]!;
    expect(fld.getAttributeNS(NS.w, "instr")).toBe(" PAGE ");
    expect(fld.getElementsByTagNameNS(NS.w, "t")[0]!.textContent).toBe("1");
  });

  it("concatenates multiple inlines in order", () => {
    const doc = render([
      { kind: "text", text: "one", properties: {} },
      { kind: "break", type: "line" },
      { kind: "text", text: "two", properties: {} },
    ]);
    const texts = Array.from(doc.getElementsByTagNameNS(NS.w, "t")).map((t) => t.textContent);
    expect(texts).toEqual(["one", "two"]);
    expect(doc.getElementsByTagNameNS(NS.w, "br")).toHaveLength(1);
  });

  it("wraps an inserted run in <w:ins> carrying author + id", () => {
    const doc = render([
      { kind: "text", text: "added", properties: { revision: { type: "ins", author: "Alice" } } },
    ]);
    const ins = doc.getElementsByTagNameNS(NS.w, "ins")[0]!;
    expect(ins).toBeDefined();
    expect(ins.getAttributeNS(NS.w, "author")).toBe("Alice");
    expect(ins.getAttributeNS(NS.w, "id")).toBeTruthy();
    // The inner run is a normal <w:t>.
    expect(ins.getElementsByTagNameNS(NS.w, "t")[0]!.textContent).toBe("added");
  });

  it("wraps a deleted run in <w:del> and uses <w:delText>", () => {
    const doc = render([
      { kind: "text", text: "gone", properties: { revision: { type: "del", author: "Bob" } } },
    ]);
    const del = doc.getElementsByTagNameNS(NS.w, "del")[0]!;
    expect(del).toBeDefined();
    expect(del.getAttributeNS(NS.w, "author")).toBe("Bob");
    expect(del.getElementsByTagNameNS(NS.w, "delText")[0]!.textContent).toBe("gone");
    expect(del.getElementsByTagNameNS(NS.w, "t")).toHaveLength(0);
  });

  it("coalesces adjacent runs with the same revision into one wrapper", () => {
    const doc = render([
      { kind: "text", text: "a", properties: { revision: { type: "ins", author: "Alice" } } },
      { kind: "text", text: "b", properties: { revision: { type: "ins", author: "Alice" } } },
    ]);
    expect(doc.getElementsByTagNameNS(NS.w, "ins")).toHaveLength(1);
    const texts = Array.from(doc.getElementsByTagNameNS(NS.w, "t")).map((t) => t.textContent);
    expect(texts).toEqual(["a", "b"]);
  });

  it("does not coalesce runs from different authors", () => {
    const doc = render([
      { kind: "text", text: "a", properties: { revision: { type: "ins", author: "Alice" } } },
      { kind: "text", text: "b", properties: { revision: { type: "ins", author: "Bob" } } },
    ]);
    expect(doc.getElementsByTagNameNS(NS.w, "ins")).toHaveLength(2);
  });

  it("renders a hyperlink run with an r:id relationship around its children", () => {
    const doc = render([
      {
        kind: "hyperlink",
        href: "https://example.com",
        children: [{ kind: "text", text: "link", properties: {} }],
      },
    ]);
    const link = doc.getElementsByTagNameNS(NS.w, "hyperlink")[0]!;
    expect(link).toBeDefined();
    expect(link.getAttributeNS(NS.r, "id")).toBeTruthy();
    expect(link.getElementsByTagNameNS(NS.w, "t")[0]!.textContent).toBe("link");
  });

  it("emits a w:rStyle reference when the run carries a styleId", () => {
    const doc = render([{ kind: "text", text: "x", properties: { styleId: "Strong" } }]);
    const rStyle = doc.getElementsByTagNameNS(NS.w, "rStyle")[0]!;
    expect(wVal(rStyle)).toBe("Strong");
  });
});
