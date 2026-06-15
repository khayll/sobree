import { describe, expect, it } from "vitest";
import { resolveStyleCascade } from "../../doc/styles";
import { parseStylesXml } from "./styles";

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/**
 * Regression coverage for the Normal-style cascade. Bug history:
 *
 *   `ensureWordBaseline` previously injected `fontFamily: "Calibri"` +
 *   `fontSizePt: 11` onto Normal whenever Normal's own `runDefaults`
 *   didn't specify them — even when `<w:docDefaults>` already provided
 *   them via the cascade. The injection silently overrode the docx
 *   author's choice. The Hungarian user-contract.docx declares Times
 *   New Roman in `<w:docDefaults><w:rPrDefault>`; Word/LibreOffice
 *   render the whole body as Times; Sobree wrongly rendered it as
 *   Calibri. The fix: only inject Calibri/11pt when the *cascade*
 *   (including DocDefaults via `basedOn`) provides no font/size.
 *
 *   Adding this test as a hard lock — any future change to
 *   `ensureWordBaseline` that re-introduces the override will fail
 *   here and pop the diff at PR time, not at the user's eyeballs.
 */
describe("parseStylesXml + ensureWordBaseline", () => {
  it("honours <w:docDefaults> rFonts via the Normal-style cascade", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="${NS_W}">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
</w:styles>`;
    const styles = parseStylesXml(xml);
    expect(styles).not.toBeNull();
    const resolved = resolveStyleCascade(styles!, "Normal");
    expect(resolved.runDefaults.fontFamily).toBe("Times New Roman");
    // Size is unspecified everywhere — last-resort baseline (11pt) wins.
    expect(resolved.runDefaults.fontSizePt).toBe(11);
  });

  it("falls back to Calibri 11pt when neither Normal nor docDefaults sets a font", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="${NS_W}">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
</w:styles>`;
    const styles = parseStylesXml(xml);
    const resolved = resolveStyleCascade(styles!, "Normal");
    expect(resolved.runDefaults.fontFamily).toBe("Calibri");
    expect(resolved.runDefaults.fontSizePt).toBe(11);
  });

  it("reads <w:shd> into paragraph-level shading on a style", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="${NS_W}">
  <w:style w:type="paragraph" w:styleId="Highlight">
    <w:name w:val="Highlight"/>
    <w:pPr>
      <w:shd w:val="clear" w:fill="FFEB9C" w:color="auto"/>
    </w:pPr>
  </w:style>
</w:styles>`;
    const styles = parseStylesXml(xml);
    const resolved = resolveStyleCascade(styles!, "Highlight");
    expect(resolved.paragraphDefaults.shading).toEqual({
      pattern: "clear",
      fill: "#FFEB9C",
    });
  });

  it("respects an explicit Normal rFonts even when docDefaults differs", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="${NS_W}">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Times New Roman"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr>
      <w:rFonts w:ascii="Cambria"/>
      <w:sz w:val="22"/>
    </w:rPr>
  </w:style>
</w:styles>`;
    const styles = parseStylesXml(xml);
    const resolved = resolveStyleCascade(styles!, "Normal");
    expect(resolved.runDefaults.fontFamily).toBe("Cambria");
    expect(resolved.runDefaults.fontSizePt).toBe(11);
  });
});

describe("heading style id canonicalisation", () => {
  it("canonicalises a spaced `Heading 2` so its colour/caps resolve via `Heading2`", () => {
    const xml = `<?xml version="1.0"?><w:styles xmlns:w="${NS_W}">
      <w:style w:type="paragraph" w:styleId="Heading 2">
        <w:name w:val="heading 2"/>
        <w:rPr><w:caps w:val="1"/><w:color w:val="357CA2"/></w:rPr>
      </w:style>
    </w:styles>`;
    const styles = parseStylesXml(xml)!;
    expect(styles.find((s) => s.id === "Heading2")).toBeDefined();
    expect(styles.find((s) => s.id === "Heading 2")).toBeUndefined();
    // The paragraph importer emits the canonical id; the cascade must hit it.
    const { runDefaults } = resolveStyleCascade(styles, "Heading2");
    expect(runDefaults.color).toBe("#357CA2");
    expect(runDefaults.caps).toBe(true);
  });

  it("canonicalises basedOn references that point at a renamed heading", () => {
    const xml = `<?xml version="1.0"?><w:styles xmlns:w="${NS_W}">
      <w:style w:type="paragraph" w:styleId="Heading 1"><w:name w:val="heading 1"/><w:rPr><w:color w:val="111111"/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="Sub"><w:basedOn w:val="Heading 1"/></w:style>
    </w:styles>`;
    const styles = parseStylesXml(xml)!;
    expect(styles.find((s) => s.id === "Sub")?.basedOn).toBe("Heading1");
    expect(resolveStyleCascade(styles, "Sub").runDefaults.color).toBe("#111111");
  });
});

describe("style paragraph borders (<w:pBdr>)", () => {
  it("reads a style's top rule into the cascade (nil sides skipped)", () => {
    const xml = `<?xml version="1.0"?><w:styles xmlns:w="${NS_W}">
      <w:style w:type="paragraph" w:styleId="Name">
        <w:pPr><w:pBdr>
          <w:top w:val="single" w:color="367DA2" w:sz="24" w:space="6"/>
          <w:bottom w:val="nil"/>
        </w:pBdr></w:pPr>
      </w:style>
    </w:styles>`;
    const styles = parseStylesXml(xml)!;
    const { paragraphDefaults } = resolveStyleCascade(styles, "Name");
    expect(paragraphDefaults.borders?.top).toMatchObject({
      style: "single",
      color: "#367DA2",
      sizeEighthsOfPt: 24,
      spaceTwips: 6,
    });
    expect(paragraphDefaults.borders?.bottom).toBeUndefined();
  });
});
