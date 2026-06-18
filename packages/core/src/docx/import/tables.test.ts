import { describe, expect, it } from "vitest";
import { NS } from "../shared/namespaces";
import { parseXml } from "../shared/xml";
import type { ConvertContext } from "./paragraph";
import { convertTable } from "./tables";

const ctx: ConvertContext = { rels: new Map() };

const table = (inner: string) =>
  convertTable(parseXml(`<w:tbl xmlns:w="${NS.w}">${inner}</w:tbl>`).documentElement, ctx);

const ONE_CELL = "<w:tr><w:tc><w:p/></w:tc></w:tr>";

describe("convertTable — width + alignment", () => {
  it("reads <w:tblW dxa> into widthTwips; ignores pct / auto", () => {
    expect(
      table(`<w:tblPr><w:tblW w:type="dxa" w:w="9000"/></w:tblPr>${ONE_CELL}`).properties
        .widthTwips,
    ).toBe(9000);
    expect(
      table(`<w:tblPr><w:tblW w:type="pct" w:w="5000"/></w:tblPr>${ONE_CELL}`).properties
        .widthTwips,
    ).toBeUndefined();
  });

  it("reads <w:jc> into alignment", () => {
    expect(table(`<w:tblPr><w:jc w:val="center"/></w:tblPr>${ONE_CELL}`).properties.alignment).toBe(
      "center",
    );
  });
});

describe("convertTable — tblLook", () => {
  it("reads the boolean attributes and inverts noHBand/noVBand to hBand/vBand", () => {
    const t = table(
      `<w:tblPr><w:tblLook w:firstRow="1" w:lastRow="0" w:firstColumn="0"
         w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>${ONE_CELL}`,
    );
    expect(t.properties.look).toEqual({ firstRow: true, hBand: true });
  });

  it("falls back to the legacy w:val bitmask when attributes are absent", () => {
    // 0x0560 = firstRow(0x20) + lastRow(0x40) + lastColumn(0x100) +
    //          noVBand(0x400). hBand on (noHBand bit clear), vBand off.
    const t = table(`<w:tblPr><w:tblLook w:val="0560"/></w:tblPr>${ONE_CELL}`);
    expect(t.properties.look).toEqual({
      firstRow: true,
      lastRow: true,
      lastColumn: true,
      hBand: true,
    });
  });
});

describe("convertTable — tblCellMar", () => {
  it("reads default cell padding into properties.cellMargins", () => {
    const t = table(
      `<w:tblPr><w:tblCellMar><w:top w:w="144"/><w:bottom w:w="144"/></w:tblCellMar></w:tblPr>${ONE_CELL}`,
    );
    expect(t.properties.cellMargins).toEqual({ topTwips: 144, bottomTwips: 144 });
  });
});

describe("convertTable — cell tcBorders", () => {
  it("reads a cell's per-side <w:tcBorders> into cell.borders", () => {
    const t = table(
      `<w:tr><w:tc>
         <w:tcPr><w:tcBorders>
           <w:bottom w:val="single" w:sz="8" w:color="FF0000"/>
         </w:tcBorders></w:tcPr>
         <w:p/>
       </w:tc></w:tr>`,
    );
    expect(t.rows[0]?.cells[0]?.borders?.bottom).toEqual({
      style: "single",
      sizeEighthsOfPt: 8,
      color: "#FF0000",
    });
  });
});
