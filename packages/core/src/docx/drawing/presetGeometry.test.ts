import { describe, expect, it } from "vitest";
import { expandPresetGeometry } from "./presetGeometry";
import { el } from "./testUtil";

/** A `<wps:wsp>` whose only geometry is the named preset (+ optional avLst). */
const shape = (prst: string, avLst = "") =>
  el(`<wps:wsp><wps:spPr><a:prstGeom prst="${prst}">${avLst}</a:prstGeom></wps:spPr></wps:wsp>`);

describe("presetGeometry — rightArrow", () => {
  it("expands a default arrow into a centred shaft + triangular head", () => {
    // 26×16 box, factory 50% adjustments: shaft spans y 4..12, head
    // begins at x 18 (ss/2 from the right) and points at (26, 8).
    const path = expandPresetGeometry(shape("rightArrow"), { widthEmu: 26, heightEmu: 16 });
    expect(path).toEqual({
      widthEmu: 26,
      heightEmu: 16,
      d: "M0 4 L18 4 L18 0 L26 8 L18 16 L18 12 L0 12 Z",
    });
  });

  it("honours an adj1 that thins the shaft", () => {
    // adj1=25000 ⇒ shaft half-height h*25000/200000 = 2 ⇒ y 6..10.
    const path = expandPresetGeometry(
      shape("rightArrow", `<a:avLst><a:gd name="adj1" fmla="val 25000"/></a:avLst>`),
      { widthEmu: 26, heightEmu: 16 },
    );
    expect(path?.d).toBe("M0 6 L18 6 L18 0 L26 8 L18 16 L18 10 L0 10 Z");
  });

  it("returns null for box-expressible / unmodelled presets", () => {
    expect(expandPresetGeometry(shape("rect"), { widthEmu: 10, heightEmu: 10 })).toBeNull();
    expect(expandPresetGeometry(shape("hexagon"), { widthEmu: 10, heightEmu: 10 })).toBeNull();
  });

  it("returns null when there is no spPr / prstGeom", () => {
    expect(expandPresetGeometry(el("<wps:wsp/>"), { widthEmu: 10, heightEmu: 10 })).toBeNull();
  });
});

describe("presetGeometry — arrow directions", () => {
  // A 40×20 box keeps the default-50% maths integer for every direction.
  const box = { widthEmu: 40, heightEmu: 20 };

  it("leftArrow mirrors rightArrow — tip at the left edge", () => {
    const path = expandPresetGeometry(shape("leftArrow"), box);
    expect(path?.d).toBe("M40 5 L10 5 L10 0 L0 10 L10 20 L10 15 L40 15 Z");
  });

  it("upArrow points to the top centre (w/2, 0)", () => {
    const path = expandPresetGeometry(shape("upArrow"), box);
    expect(path?.d).toBe("M10 20 L10 10 L0 10 L20 0 L40 10 L30 10 L30 20 Z");
  });

  it("downArrow points to the bottom centre (w/2, h)", () => {
    const path = expandPresetGeometry(shape("downArrow"), box);
    expect(path?.d).toBe("M10 0 L10 10 L0 10 L20 20 L40 10 L30 10 L30 0 Z");
  });

  it("rightArrow in the same box stays the integer reference", () => {
    const path = expandPresetGeometry(shape("rightArrow"), box);
    expect(path?.d).toBe("M0 5 L30 5 L30 0 L40 10 L30 20 L30 15 L0 15 Z");
  });
});
