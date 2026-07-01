import { describe, expect, it } from "vitest";
import type { NamedStyle, RunProperties, TextRun } from "../../../doc/types";
import { appendInlineRuns } from "./inline";

/** Render one text run and return the styled <span> wrapping it (if any). */
function runSpan(properties: TextRun["properties"]): HTMLElement | null {
  const host = document.createElement("p");
  appendInlineRuns(host, [{ kind: "text", text: "x", properties }]);
  return host.querySelector("span");
}

/** Render one text run in the given paragraph/style context and report its
 *  effective toggles (bold via <strong>, caps via text-transform). */
function renderRunToggles(
  properties: RunProperties,
  paragraphRunDefaults: RunProperties = {},
  styles: readonly NamedStyle[] = [],
): { bold: boolean; caps: boolean } {
  const host = document.createElement("p");
  appendInlineRuns(
    host,
    [{ kind: "text", text: "x", properties }],
    {},
    styles,
    paragraphRunDefaults,
  );
  const span = host.querySelector("span");
  return {
    bold: host.querySelector("strong") !== null,
    caps: (span?.style.textTransform ?? "") === "uppercase",
  };
}

describe("run toggle resolution — XOR across the style cascade", () => {
  const capsChar: NamedStyle = {
    id: "CapsChar",
    type: "character",
    displayName: "Caps",
    runDefaults: { caps: true },
  };

  it("keeps caps when only the paragraph style sets it (single level)", () => {
    expect(renderRunToggles({}, { caps: true }).caps).toBe(true);
  });

  it("CANCELS caps when both the paragraph style AND the char style set it (XOR)", () => {
    // The ACM author case: `Authors` (paragraph) + `AuthorsChar` cancel.
    expect(renderRunToggles({ styleId: "CapsChar" }, { caps: true }, [capsChar]).caps).toBe(false);
  });

  it("a direct explicit `caps: false` overrides an inherited paragraph-style caps", () => {
    // The ACM first-author `<w:caps w:val="0"/>` case.
    expect(renderRunToggles({ caps: false }, { caps: true }).caps).toBe(false);
  });

  it("inherits paragraph-style bold onto a run with no formatting", () => {
    expect(renderRunToggles({}, { bold: true }).bold).toBe(true);
  });
});

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
