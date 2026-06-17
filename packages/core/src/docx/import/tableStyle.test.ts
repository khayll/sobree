import { describe, expect, it } from "vitest";
import { NS } from "../shared/namespaces";
import { parseXml } from "../shared/xml";
import { readTableStyle } from "./tableStyle";

const style = (inner: string): Element =>
  parseXml(`<w:style xmlns:w="${NS.w}" w:type="table" w:styleId="Gold">${inner}</w:style>`)
    .documentElement;

describe("readTableStyle", () => {
  it("reads base grid borders + band size from the style's tblPr", () => {
    const def = readTableStyle(
      style(`
        <w:tblPr>
          <w:tblStyleRowBandSize w:val="1"/>
          <w:tblBorders>
            <w:insideH w:val="single" w:sz="4" w:color="62666A"/>
            <w:insideV w:val="single" w:sz="4" w:color="62666A"/>
          </w:tblBorders>
        </w:tblPr>`),
    );
    expect(def?.rowBandSize).toBe(1);
    expect(def?.borders?.insideH).toEqual({
      style: "single",
      sizeEighthsOfPt: 4,
      color: "#62666A",
    });
    expect(def?.borders?.insideV?.color).toBe("#62666A");
  });

  it("reads style-level default cell padding from tblCellMar", () => {
    const def = readTableStyle(
      style(
        `<w:tblPr><w:tblCellMar><w:left w:w="108"/><w:right w:w="108"/></w:tblCellMar></w:tblPr>`,
      ),
    );
    expect(def?.cellMargins).toEqual({ leftTwips: 108, rightTwips: 108 });
  });

  it("reads conditional fills from <w:tblStylePr> regions", () => {
    const def = readTableStyle(
      style(`
        <w:tblStylePr w:type="firstRow">
          <w:tcPr><w:shd w:val="clear" w:fill="FFCD00"/></w:tcPr>
        </w:tblStylePr>
        <w:tblStylePr w:type="band2Horz">
          <w:tcPr><w:shd w:val="clear" w:fill="E3E4E4"/></w:tcPr>
        </w:tblStylePr>`),
    );
    expect(def?.conditional?.firstRow?.shading?.fill).toBe("#FFCD00");
    expect(def?.conditional?.band2Horz?.shading?.fill).toBe("#E3E4E4");
  });

  it("reads per-side cell borders inside a conditional region", () => {
    const def = readTableStyle(
      style(`
        <w:tblStylePr w:type="firstRow">
          <w:tcPr>
            <w:tcBorders><w:bottom w:val="single" w:sz="12" w:color="000000"/></w:tcBorders>
          </w:tcPr>
        </w:tblStylePr>`),
    );
    expect(def?.conditional?.firstRow?.borders?.bottom).toEqual({
      style: "single",
      sizeEighthsOfPt: 12,
      color: "#000000",
    });
  });

  it("folds a wholeTable region into the base", () => {
    const def = readTableStyle(
      style(`
        <w:tblStylePr w:type="wholeTable">
          <w:tcPr><w:shd w:val="clear" w:fill="EEEEEE"/></w:tcPr>
        </w:tblStylePr>`),
    );
    expect(def?.shading?.fill).toBe("#EEEEEE");
    expect(def?.conditional).toBeUndefined();
  });

  it("returns null for a style with no table formatting", () => {
    expect(readTableStyle(style(""))).toBeNull();
  });
});
