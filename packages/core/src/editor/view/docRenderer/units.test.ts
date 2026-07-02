import { describe, expect, it } from "vitest";

import { EMU_PER_MM, EMU_PER_PX, emuToMm, emuToPx, twipsToMm, twipsToMmExact } from "./units";

describe("units", () => {
  it("pins EMU_PER_MM to the integer literal 36000 (no float drift)", () => {
    // Critical: computing 914400 / 25.4 can drift off 36000 in float,
    // which would change emitted CSS strings. The renderer relies on
    // the exact literal.
    expect(EMU_PER_MM).toBe(36000);
    expect(Number.isInteger(EMU_PER_MM)).toBe(true);
  });

  it("pins EMU_PER_PX to 9525", () => {
    expect(EMU_PER_PX).toBe(9525);
  });

  it("emuToMm is exact division by 36000", () => {
    expect(emuToMm(36000)).toBe(1);
    expect(emuToMm(18000)).toBe(0.5);
    expect(emuToMm(0)).toBe(0);
    // A real frame height from complex-multipage's Objective band.
    expect(emuToMm(552450)).toBeCloseTo(15.345833, 5);
  });

  it("emuToPx is exact division by 9525", () => {
    expect(emuToPx(9525)).toBe(1);
    expect(emuToPx(914400)).toBe(96); // 1 inch = 96 px
  });

  it("twipsToMm keeps sub-twip precision (3 decimals), never whole-mm rounds", () => {
    expect(twipsToMm(1440)).toBe(25.4); // 1 inch, exact
    expect(twipsToMm(720)).toBe(12.7); // 0.5 inch, exact
    // Point-authored spacing must survive: 160 twips = 8pt = 2.822mm.
    // Whole-mm rounding (→ 3mm) grew every spaced paragraph by ~0.68px
    // and moved page counts on paragraph-dense documents.
    expect(twipsToMm(160)).toBe(2.822);
    expect(twipsToMm(240)).toBe(4.233); // 12pt default after-spacing
    expect(twipsToMm(0)).toBe(0);
  });

  it("twipsToMmExact preserves sub-mm precision", () => {
    expect(twipsToMmExact(1440)).toBeCloseTo(25.4, 5);
    expect(twipsToMmExact(720)).toBeCloseTo(12.7, 5);
  });
});
