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

describe("resolveAnchorPosition — align and percent forms", () => {
  const PAGE_W = 7772400; // 8.5in
  const PAGE_H = 10058400; // 11in
  const fullGeom = {
    ...geom,
    pageWidthEmu: PAGE_W,
    pageHeightEmu: PAGE_H,
    marginRightEmu: MARGIN_LEFT,
    marginBottomEmu: MARGIN_TOP,
  };

  function positioned(over: Partial<AnchoredFrame>): AnchoredFrame {
    return { ...frame("page", "page"), offsetXEmu: 0, offsetYEmu: 0, ...over };
  }

  it("align center on page → frame centred in the page box", () => {
    const f = positioned({ alignH: "center", alignV: "center", widthEmu: 400, heightEmu: 600 });
    const { xEmu, yEmu } = resolveAnchorPosition(f, fullGeom);
    expect(xEmu).toBe((PAGE_W - 400) / 2);
    expect(yEmu).toBe((PAGE_H - 600) / 2);
  });

  it("align center on margin → centred in the content box, from the margin origin", () => {
    const f = { ...positioned({ alignH: "center", widthEmu: 400 }) };
    f.anchor = { sectionIndex: 0, verticalFrom: "page", horizontalFrom: "margin" };
    const contentW = PAGE_W - 2 * MARGIN_LEFT;
    expect(resolveAnchorPosition(f, fullGeom).xEmu).toBe(MARGIN_LEFT + (contentW - 400) / 2);
  });

  it("pctPosY 1.0 on margin → frame top at the bottom margin line (the footer bar)", () => {
    const f = positioned({ pctPosY: 1, heightEmu: 250000 });
    f.anchor = { sectionIndex: 0, verticalFrom: "margin", horizontalFrom: "page" };
    const contentH = PAGE_H - MARGIN_TOP - MARGIN_TOP;
    expect(resolveAnchorPosition(f, fullGeom).yEmu).toBe(MARGIN_TOP + contentH);
  });

  it("without base-extent geometry, align/pct degrade to the plain offset", () => {
    const f = positioned({ alignV: "center", pctPosX: 0.5, offsetXEmu: 111, offsetYEmu: 222 });
    const { xEmu, yEmu } = resolveAnchorPosition(f, geom);
    expect(xEmu).toBe(111);
    expect(yEmu).toBe(222);
  });
});
