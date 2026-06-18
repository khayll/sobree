import { describe, expect, it } from "vitest";
import type { TextRun } from "../../../doc/types";
import { appendInlineRuns } from "./inline";

/** Render one text run and return the styled <span> wrapping it (if any). */
function runSpan(properties: TextRun["properties"]): HTMLElement | null {
  const host = document.createElement("p");
  appendInlineRuns(host, [{ kind: "text", text: "x", properties }]);
  return host.querySelector("span");
}

describe("run CSS — previously-unrendered properties", () => {
  it("smallCaps → font-variant-caps:small-caps", () => {
    expect(runSpan({ smallCaps: true })?.style.fontVariantCaps).toBe("small-caps");
  });

  it("doubleStrike → double line-through", () => {
    const style = runSpan({ doubleStrike: true })?.getAttribute("style") ?? "";
    expect(style).toContain("line-through double");
  });

  it("run shading fill → background; auto is ignored", () => {
    expect(runSpan({ shading: { pattern: "clear", fill: "#FFE08A" } })?.style.background).toContain(
      "rgb(255, 224, 138)",
    );
    expect(runSpan({ shading: { pattern: "clear", fill: "auto" } })).toBeNull();
  });

  it("hidden → span carries the sobree-hidden class (CSS-controlled)", () => {
    expect(runSpan({ hidden: true })?.className).toBe("sobree-hidden");
  });
});
