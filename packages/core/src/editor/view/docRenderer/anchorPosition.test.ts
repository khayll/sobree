import { describe, expect, it } from "vitest";
import type { AnchoredFrame } from "../../../doc/types";
import { resolveAnchorPosition } from "./anchorPosition";

const MARGIN_TOP = 360000; // 10mm
const MARGIN_LEFT = 720000; // 20mm
const PARA_TOP = 2520000; // 70mm
const OFF_X = 90000; // 2.5mm
const OFF_Y = 180000; // 5mm

function frame(
  verticalFrom: AnchoredFrame["anchor"]["verticalFrom"],
  horizontalFrom: AnchoredFrame["anchor"]["horizontalFrom"],
): AnchoredFrame {
  return {
    id: "f",
    anchor: { sectionIndex: 0, verticalFrom, horizontalFrom },
    offsetXEmu: OFF_X,
    offsetYEmu: OFF_Y,
    widthEmu: 100,
    heightEmu: 100,
    content: { kind: "shape", geometry: "rect" },
  };
}

const geom = { marginTopEmu: MARGIN_TOP, marginLeftEmu: MARGIN_LEFT, anchorParaTopEmu: PARA_TOP };

describe("resolveAnchorPosition — vertical origin", () => {
  it("page → from the page edge (0 + offset)", () => {
    expect(resolveAnchorPosition(frame("page", "page"), geom).yEmu).toBe(OFF_Y);
  });
  it("margin → from the top margin", () => {
    expect(resolveAnchorPosition(frame("margin", "page"), geom).yEmu).toBe(MARGIN_TOP + OFF_Y);
  });
  it("paragraph → from the anchor paragraph's rendered top", () => {
    expect(resolveAnchorPosition(frame("paragraph", "page"), geom).yEmu).toBe(PARA_TOP + OFF_Y);
  });
  it("paragraph with no anchor paragraph → falls back to margin (never page)", () => {
    const g = { marginTopEmu: MARGIN_TOP, marginLeftEmu: MARGIN_LEFT, anchorParaTopEmu: null };
    expect(resolveAnchorPosition(frame("paragraph", "page"), g).yEmu).toBe(MARGIN_TOP + OFF_Y);
  });
});

describe("resolveAnchorPosition — horizontal origin", () => {
  it("page → from the page edge", () => {
    expect(resolveAnchorPosition(frame("page", "page"), geom).xEmu).toBe(OFF_X);
  });
  it("margin → from the left margin", () => {
    expect(resolveAnchorPosition(frame("page", "margin"), geom).xEmu).toBe(MARGIN_LEFT + OFF_X);
  });
  it("column → from the column (= left margin for single-column)", () => {
    expect(resolveAnchorPosition(frame("page", "column"), geom).xEmu).toBe(MARGIN_LEFT + OFF_X);
  });
});

describe("resolveAnchorPosition — combined", () => {
  it("paragraph V + column H resolves both axes", () => {
    const { xEmu, yEmu } = resolveAnchorPosition(frame("paragraph", "column"), geom);
    expect(xEmu).toBe(MARGIN_LEFT + OFF_X);
    expect(yEmu).toBe(PARA_TOP + OFF_Y);
  });
});
