import { describe, expect, it } from "vitest";
import { renderStylesXml } from "./styles";
import { defaultStyles } from "../../doc/builders";
import { NS } from "../shared/namespaces";
import { parseXml, wVal } from "../shared/xml";
import type { NamedStyle } from "../../doc/types";

function styleById(doc: Document, id: string): Element | undefined {
  return Array.from(doc.getElementsByTagNameNS(NS.w, "style")).find(
    (el) => el.getAttributeNS(NS.w, "styleId") === id,
  );
}

describe("renderStylesXml", () => {
  it("emits a w:styles root with docDefaults", () => {
    const doc = parseXml(renderStylesXml(defaultStyles()));
    expect(doc.documentElement.localName).toBe("styles");
    expect(doc.documentElement.namespaceURI).toBe(NS.w);
    expect(doc.getElementsByTagNameNS(NS.w, "docDefaults")).toHaveLength(1);
  });

  it("emits one w:style per input style", () => {
    const styles = defaultStyles();
    const doc = parseXml(renderStylesXml(styles));
    const ids = Array.from(doc.getElementsByTagNameNS(NS.w, "style")).map((el) =>
      el.getAttributeNS(NS.w, "styleId"),
    );
    for (const style of styles) {
      expect(ids).toContain(style.id);
    }
  });

  it("carries the style id, type, and display name", () => {
    const doc = parseXml(renderStylesXml(defaultStyles()));
    const heading1 = styleById(doc, "Heading1")!;
    expect(heading1.getAttributeNS(NS.w, "type")).toBe("paragraph");
    const name = heading1.getElementsByTagNameNS(NS.w, "name")[0]!;
    expect(wVal(name)).toBe("heading 1");
  });

  it("marks the Normal style as the default", () => {
    const doc = parseXml(renderStylesXml(defaultStyles()));
    const normal = styleById(doc, "Normal")!;
    expect(normal.getAttributeNS(NS.w, "default")).toBe("1");
  });

  it("synthesises a Normal default when none is supplied", () => {
    const onlyHeading: NamedStyle[] = [
      { id: "Heading1", type: "paragraph", displayName: "heading 1" },
    ];
    const doc = parseXml(renderStylesXml(onlyHeading));
    const normal = styleById(doc, "Normal");
    expect(normal).toBeDefined();
    expect(normal!.getAttributeNS(NS.w, "default")).toBe("1");
  });

  it("emits basedOn and next references for headings", () => {
    const doc = parseXml(renderStylesXml(defaultStyles()));
    const heading1 = styleById(doc, "Heading1")!;
    const basedOn = heading1.getElementsByTagNameNS(NS.w, "basedOn")[0]!;
    const next = heading1.getElementsByTagNameNS(NS.w, "next")[0]!;
    expect(wVal(basedOn)).toBe("Normal");
    expect(wVal(next)).toBe("Normal");
  });

  it("renders run defaults (bold + font + size) into the style rPr", () => {
    const styles: NamedStyle[] = [
      {
        id: "Custom",
        type: "paragraph",
        displayName: "Custom",
        runDefaults: { bold: true, fontFamily: "Georgia", fontSizePt: 14, color: "#ff0000" },
      },
    ];
    const doc = parseXml(renderStylesXml(styles));
    const custom = styleById(doc, "Custom")!;
    const rPr = custom.getElementsByTagNameNS(NS.w, "rPr")[0]!;
    expect(rPr.getElementsByTagNameNS(NS.w, "b")).toHaveLength(1);
    const fonts = rPr.getElementsByTagNameNS(NS.w, "rFonts")[0]!;
    expect(fonts.getAttributeNS(NS.w, "ascii")).toBe("Georgia");
    // 14pt -> 28 half-points.
    expect(wVal(rPr.getElementsByTagNameNS(NS.w, "sz")[0]!)).toBe("28");
    // Color hash is stripped.
    expect(wVal(rPr.getElementsByTagNameNS(NS.w, "color")[0]!)).toBe("ff0000");
  });
});
