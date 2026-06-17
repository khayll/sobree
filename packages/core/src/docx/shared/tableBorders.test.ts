import { describe, expect, it } from "vitest";
import { NS } from "./namespaces";
import { readCellBorders, readCellMargins, readTableBorders } from "./tableBorders";
import { parseXml } from "./xml";

const el = (tag: string, inner: string) =>
  parseXml(`<w:${tag} xmlns:w="${NS.w}">${inner}</w:${tag}>`).documentElement;

describe("readTableBorders", () => {
  it("reads outer edges + insideH/insideV with default size + #-prefixed colour", () => {
    const b = readTableBorders(
      el(
        "tblBorders",
        `<w:top w:val="single" w:color="62666A"/>
         <w:insideH w:val="double" w:sz="6" w:color="auto"/>`,
      ),
    );
    expect(b?.top).toEqual({ style: "single", sizeEighthsOfPt: 4, color: "#62666A" });
    expect(b?.insideH).toEqual({ style: "double", sizeEighthsOfPt: 6, color: "auto" });
  });

  it("drops explicit no-border sides (w:val=none/nil)", () => {
    const b = readTableBorders(el("tblBorders", `<w:top w:val="none"/><w:bottom w:val="nil"/>`));
    expect(b).toBeNull();
  });

  it("coerces unknown border styles to single", () => {
    const b = readTableBorders(el("tblBorders", `<w:left w:val="wave" w:sz="4"/>`));
    expect(b?.left?.style).toBe("single");
  });
});

describe("readCellBorders", () => {
  it("reads only the four cell edges (no insideH/insideV)", () => {
    const b = readCellBorders(
      el(
        "tcBorders",
        `<w:left w:val="single" w:sz="4" w:color="000000"/>
         <w:insideH w:val="single" w:sz="4" w:color="000000"/>`,
      ),
    );
    expect(b?.left).toEqual({ style: "single", sizeEighthsOfPt: 4, color: "#000000" });
    expect(b && "insideH" in b).toBe(false);
  });
});

describe("readCellMargins", () => {
  it("reads per-side w:w (twips), keeping only declared sides", () => {
    const m = readCellMargins(el("tblCellMar", `<w:top w:w="144"/><w:bottom w:w="144"/>`));
    expect(m).toEqual({ topTwips: 144, bottomTwips: 144 });
  });

  it("reads all four sides", () => {
    const m = readCellMargins(
      el("tcMar", `<w:top w:w="0"/><w:right w:w="108"/><w:bottom w:w="0"/><w:left w:w="108"/>`),
    );
    expect(m).toEqual({ topTwips: 0, rightTwips: 108, bottomTwips: 0, leftTwips: 108 });
  });

  it("returns null when no side carries a width", () => {
    expect(readCellMargins(el("tblCellMar", ""))).toBeNull();
  });
});
