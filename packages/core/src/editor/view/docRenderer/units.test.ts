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

  it("twipsToMm rounds to the nearest whole millimetre", () => {
    expect(twipsToMm(1440)).toBe(25); // 1 inch ≈ 25mm (rounded from 25.4)
    expect(twipsToMm(567)).toBe(10); // 567 twips ≈ 10.0mm
    expect(twipsToMm(283)).toBe(5); // 283 twips ≈ 4.99mm → 5
    expect(twipsToMm(0)).toBe(0);
  });

  it("twipsToMmExact preserves sub-mm precision", () => {
    expect(twipsToMmExact(1440)).toBeCloseTo(25.4, 5);
    expect(twipsToMmExact(720)).toBeCloseTo(12.7, 5);
  });
});
