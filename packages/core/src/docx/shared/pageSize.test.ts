import { describe, expect, it } from "vitest";
import { type PageGeometry, geometryToTwips, matchPageSize } from "./pageSize";
import { mmToTwips } from "./units";

describe("matchPageSize", () => {
  it("detects A4 portrait from exact twip dimensions", () => {
    const w = mmToTwips(210);
    const h = mmToTwips(297);
    expect(matchPageSize(w, h)).toEqual({ size: "A4", orientation: "portrait" });
  });

  it("detects A4 landscape when width > height", () => {
    const w = mmToTwips(297);
    const h = mmToTwips(210);
    expect(matchPageSize(w, h)).toEqual({ size: "A4", orientation: "landscape" });
  });

  it("detects Letter portrait (215.9 × 279.4 mm)", () => {
    const w = mmToTwips(215.9);
    const h = mmToTwips(279.4);
    expect(matchPageSize(w, h)).toEqual({ size: "Letter", orientation: "portrait" });
  });

  it("snaps a slightly-off A4 to the nearest known size", () => {
    const w = mmToTwips(211);
    const h = mmToTwips(296);
    expect(matchPageSize(w, h).size).toBe("A4");
  });

  it("treats square dimensions as portrait", () => {
    const s = mmToTwips(210);
    expect(matchPageSize(s, s).orientation).toBe("portrait");
  });
});

describe("geometryToTwips", () => {
  it("returns the twip W/H for A4 portrait", () => {
    const geom: PageGeometry = {
      size: "A4",
      orientation: "portrait",
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
    };
    expect(geometryToTwips(geom)).toEqual({ w: mmToTwips(210), h: mmToTwips(297) });
  });

  it("swaps W/H for landscape", () => {
    const geom: PageGeometry = {
      size: "A4",
      orientation: "landscape",
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
    };
    expect(geometryToTwips(geom)).toEqual({ w: mmToTwips(297), h: mmToTwips(210) });
  });

  it("round-trips geometry → twips → matchPageSize", () => {
    const geom: PageGeometry = {
      size: "Letter",
      orientation: "landscape",
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
    };
    const { w, h } = geometryToTwips(geom);
    expect(matchPageSize(w, h)).toEqual({ size: "Letter", orientation: "landscape" });
  });
});
