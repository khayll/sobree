import { describe, expect, it } from "vitest";
import { parseNumberingXml } from "./numbering";

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** numbering.xml where numId=2's abstractNum DEFERS its levels to the
 *  "Bullet" numbering style (numStyleLink), whose definition lives in a
 *  different abstractNum (styleLink) — Word's real bullet-list shape. */
const styleLinkXml = (defFirst: boolean): string => {
  const ref = `
    <w:abstractNum w:abstractNumId="0">
      <w:multiLevelType w:val="hybridMultilevel"/>
      <w:numStyleLink w:val="Bullet"/>
    </w:abstractNum>`;
  const def = `
    <w:abstractNum w:abstractNumId="1">
      <w:styleLink w:val="Bullet"/>
      <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl>
    </w:abstractNum>`;
  return `<w:numbering ${NS}>
    ${defFirst ? def + ref : ref + def}
    <w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num>
  </w:numbering>`;
};

describe("parseNumberingXml — numStyleLink resolution", () => {
  it("resolves a numStyleLink abstractNum to the linked style definition's bullet levels", () => {
    const defs = parseNumberingXml(styleLinkXml(false));
    const num2 = defs.find((d) => d.numId === 2);
    expect(num2?.abstractFormat.levels[0]).toMatchObject({ format: "bullet", text: "•" });
  });

  it("resolves regardless of document order (definition after the reference)", () => {
    const defs = parseNumberingXml(styleLinkXml(true));
    expect(defs.find((d) => d.numId === 2)?.abstractFormat.levels[0]?.format).toBe("bullet");
  });

  it("leaves a self-contained numbered list as decimal (no false bullet)", () => {
    const defs = parseNumberingXml(`<w:numbering ${NS}>
      <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
    </w:numbering>`);
    expect(defs.find((d) => d.numId === 1)?.abstractFormat.levels[0]?.format).toBe("decimal");
  });
});

describe("parseNumberingXml — marker rPr", () => {
  const xml = (rPr: string) => `<w:numbering ${NS}>
    <w:abstractNum w:abstractNumId="0">
      <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>
        <w:rPr>${rPr}</w:rPr>
      </w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  </w:numbering>`;
  const lvl0 = (rPr: string) =>
    parseNumberingXml(xml(rPr)).find((d) => d.numId === 1)?.abstractFormat.levels[0];

  it("reads marker colour, font, and size into runDefaults", () => {
    const lvl = lvl0(
      `<w:rFonts w:hAnsi="Arial Unicode MS"/><w:color w:val="7f8685"/><w:sz w:val="20"/>`,
    );
    expect(lvl?.runDefaults).toEqual({
      color: "#7F8685",
      fontFamily: "Arial Unicode MS",
      fontSizePt: 10,
    });
  });

  it("suppresses SYMBOL fonts (remapped glyphs would render wrong) but keeps colour", () => {
    const lvl = lvl0(`<w:rFonts w:ascii="Wingdings"/><w:color w:val="FF0000"/>`);
    expect(lvl?.runDefaults?.fontFamily).toBeUndefined();
    expect(lvl?.runDefaults?.color).toBe("#FF0000");
  });

  it("omits runDefaults entirely when the rPr carries nothing renderable", () => {
    expect(lvl0(`<w:color w:val="auto"/>`)?.runDefaults).toBeUndefined();
  });
});
