import { describe, expect, it } from "vitest";
import { Paper } from "./paper";
import { DEFAULT_PAGE_SETUP } from "./pageSetup";
import type { SectionProperties } from "../doc/types";

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
