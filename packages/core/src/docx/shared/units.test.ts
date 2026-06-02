import { describe, expect, it } from "vitest";
import {
  SINGLE_SPACING_LINE,
  emuToPx,
  halfPtToPt,
  lineHeightToOoxml,
  mmToTwips,
  ooxmlLineHeightToCss,
  ptToHalfPt,
  ptToTwips,
  pxToEmu,
  twipsToMm,
  twipsToPt,
} from "./units";

describe("units — half-points", () => {
  it("converts half-points to pt", () => {
    expect(halfPtToPt(24)).toBe(12);
    expect(halfPtToPt(1)).toBe(0.5);
  });

  it("converts pt to rounded half-points", () => {
    expect(ptToHalfPt(12)).toBe(24);
    expect(ptToHalfPt(0.5)).toBe(1);
    expect(ptToHalfPt(5.7)).toBe(11); // 11.4 rounds to 11
  });

  it("round-trips pt → halfPt → pt", () => {
    expect(halfPtToPt(ptToHalfPt(12))).toBe(12);
  });
});

describe("units — EMU ↔ px", () => {
  it("converts 1 inch of EMU to 96 px", () => {
    expect(emuToPx(914400)).toBe(96);
  });

  it("converts 96 px to 1 inch of EMU", () => {
    expect(pxToEmu(96)).toBe(914400);
  });

  it("round-trips px → emu → px", () => {
    expect(emuToPx(pxToEmu(150))).toBe(150);
  });
});

describe("units — twips conversions", () => {
  it("1440 twips equals 1 inch in pt (72) and mm (25.4)", () => {
    expect(twipsToPt(1440)).toBe(72);
    expect(twipsToMm(1440)).toBeCloseTo(25.4, 10);
  });

  it("converts mm back to twips", () => {
    expect(mmToTwips(25.4)).toBe(1440);
  });

  it("converts pt back to twips", () => {
    expect(ptToTwips(72)).toBe(1440);
  });

  it("round-trips twips → mm → twips", () => {
    expect(mmToTwips(twipsToMm(1440))).toBe(1440);
  });

  it("round-trips twips → pt → twips", () => {
    expect(ptToTwips(twipsToPt(1440))).toBe(1440);
  });
});

describe("units — line spacing", () => {
  it("SINGLE_SPACING_LINE is 240", () => {
    expect(SINGLE_SPACING_LINE).toBe(240);
  });

  it("lineHeightToOoxml(1) is 240 (single spacing)", () => {
    expect(lineHeightToOoxml(1)).toBe(240);
  });

  it("lineHeightToOoxml(1.5) is 360", () => {
    expect(lineHeightToOoxml(1.5)).toBe(360);
  });

  it("ooxmlLineHeightToCss(360) is 1.5", () => {
    expect(ooxmlLineHeightToCss(360)).toBe(1.5);
  });

  it("ooxmlLineHeightToCss(240) is 1", () => {
    expect(ooxmlLineHeightToCss(240)).toBe(1);
  });

  it("round-trips lineHeight → ooxml → css", () => {
    expect(ooxmlLineHeightToCss(lineHeightToOoxml(2))).toBe(2);
  });
});
