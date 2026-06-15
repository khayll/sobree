import { describe, expect, it } from "vitest";
import type { SectionProperties } from "../doc/types";
import type { AnchorLayerContext } from "../editor/view/docRenderer/anchorLayer";
import { DEFAULT_PAGE_SETUP } from "./pageSetup";
import { Paper } from "./paper";

function makePaper(): Paper {
  return new Paper(document.createElement("div"), DEFAULT_PAGE_SETUP);
}

// applySectionOverride only reads `vAlign` (+ optional pageMargins); a
// partial cast is enough to exercise the vertical-alignment branch.
const section = (vAlign: SectionProperties["vAlign"]): SectionProperties =>
  ({ vAlign }) as SectionProperties;

describe("Paper vertical alignment → content layout", () => {
  it("defaults to flow-root (no inline display) so floats wrap across paragraphs", () => {
    // DEFAULT_PAGE_SETUP.verticalAlign is "top" → inline display cleared,
    // letting the CSS `.paper-content { display: flow-root }` apply.
    expect(makePaper().content.style.display).toBe("");
  });

  it("switches to a flex column for vAlign center / bottom / both", () => {
    const p = makePaper();
    p.applySectionOverride(section("center"));
    expect(p.content.style.display).toBe("flex");
    expect(p.content.style.justifyContent).toBe("center");
    p.applySectionOverride(section("bottom"));
    expect(p.content.style.justifyContent).toBe("flex-end");
    p.applySectionOverride(section("both"));
    expect(p.content.style.justifyContent).toBe("space-between");
  });

  it("reverts to flow-root when a later section is top-aligned", () => {
    const p = makePaper();
    p.applySectionOverride(section("center"));
    p.applySectionOverride(section("top"));
    expect(p.content.style.display).toBe("");
    expect(p.content.style.justifyContent).toBe("");
  });
});

describe("Paper behind-text frame routing", () => {
  const frame = (behindText: boolean): import("../doc/types").AnchoredFrame => ({
    id: behindText ? "b1" : "f1",
    anchor: { sectionIndex: 0, horizontalFrom: "page", verticalFrom: "page" },
    offsetXEmu: 0,
    offsetYEmu: 0,
    widthEmu: 914400,
    heightEmu: 914400,
    ...(behindText ? { behindText: true } : {}),
    content: { kind: "shape", geometry: "rect", fill: "#FFFFFF" },
  });
  const ctx = { rawParts: {} } as AnchorLayerContext;

  it("routes behindText frames into the behind layer, others into the overlay", () => {
    const p = makePaper();
    p.setAnchoredFrames([frame(true), frame(false)], ctx);
    const behind = p.root.querySelector(".paper-anchors-behind");
    const front = p.root.querySelector(".paper-anchors");
    expect(behind?.children.length).toBe(1);
    expect(front?.children.length).toBe(1);
    expect(behind?.classList.contains("is-empty")).toBe(false);
  });

  it("the behind layer is the paper's FIRST child (paints below the body)", () => {
    const p = makePaper();
    expect(p.root.firstElementChild?.className).toContain("paper-anchors-behind");
  });
});
