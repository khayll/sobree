import { describe, expect, it } from "vitest";
import { readTextDistances } from "./margins";
import { el } from "./testUtil";

describe("margins — distT/B/L/R text distances", () => {
  it("reads all four sides into an EMU record", () => {
    const anchor = el(`<wp:anchor distT="45720" distB="45720" distL="91440" distR="91440"/>`);
    expect(readTextDistances(anchor)).toEqual({
      topEmu: 45720,
      bottomEmu: 45720,
      leftEmu: 91440,
      rightEmu: 91440,
    });
  });

  it("returns undefined when no distance attribute is present", () => {
    expect(readTextDistances(el(`<wp:anchor behindDoc="1"/>`))).toBeUndefined();
  });

  it("zero-fills omitted sides when at least one is declared", () => {
    expect(readTextDistances(el(`<wp:anchor distL="114300"/>`))).toEqual({
      topEmu: 0,
      bottomEmu: 0,
      leftEmu: 114300,
      rightEmu: 0,
    });
  });
});
