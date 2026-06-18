import { describe, expect, it } from "vitest";

import type { NamedStyle, ParagraphProperties } from "../../../doc/types";
import { applyParagraphProps } from "./properties";

const doc = window.document;
function p(props: ParagraphProperties, styles: NamedStyle[] = [], tag = "p"): HTMLElement {
  const el = doc.createElement(tag);
  applyParagraphProps(el, props, styles);
  return el;
}

describe("applyParagraphProps", () => {
  it("maps alignment 'both' to justify", () => {
    expect(p({ alignment: "both" }).style.textAlign).toBe("justify");
    expect(p({ alignment: "center" }).style.textAlign).toBe("center");
  });

  it("emits firstLine indent as positive text-indent, hanging as negative", () => {
    expect(p({ indent: { firstLineTwips: 720 } }).style.textIndent).toBe("13mm"); // 720tw ≈ 12.7 → 13
    expect(p({ indent: { leftTwips: 720, hangingTwips: 360 } }).style.textIndent).toBe("-6mm");
    // first-line indent is NOT applied to list items (marker geometry owns it)
    expect(p({ indent: { firstLineTwips: 720 } }, [], "li").style.textIndent).toBe("");
  });

  it("emits spacing before/after as mm margins (rounded)", () => {
    const el = p({ spacing: { beforeTwips: 240, afterTwips: 120 } });
    expect(el.style.marginTop).toBe("4mm"); // 240 twips ≈ 4.23 → 4
    expect(el.style.marginBottom).toBe("2mm"); // 120 twips ≈ 2.1 → 2
  });

  it("line=240 auto → line-height:normal; multi-line scales by natural leading", () => {
    expect(p({ spacing: { line: 240, lineRule: "auto" } }).style.lineHeight).toBe("normal");
    // 360/240 = 1.5 × default leading 1.15 = 1.725
    const el = p({ spacing: { line: 360, lineRule: "auto" } });
    expect(Number(el.style.lineHeight)).toBeCloseTo(1.725, 3);
  });

  it("uses the uniform 1.15 natural leading for Calibri (matches LibreOffice)", () => {
    // An earlier 1.05 special-case for Calibri was a mis-calibration that
    // compensated for a wrong 11pt run-default font size; with the size
    // corrected to 10pt, Calibri matches LibreOffice at the same 1.15
    // leading every other font uses. 1.5 × 1.15 = 1.725.
    const el = p({
      spacing: { line: 360, lineRule: "auto" },
      runDefaults: { fontFamily: "Calibri" },
    });
    expect(Number(el.style.lineHeight)).toBeCloseTo(1.725, 3);
  });

  it("lineRule=exact emits a FIXED pt line-height (line twips → pt), font-independent", () => {
    // line=640 twips = 32pt; the big-font value the stat fact-sheet uses.
    expect(p({ spacing: { line: 640, lineRule: "exact" } }).style.lineHeight).toBe("32pt");
    // Independent of the run font (exact is a fixed box, not a multiplier).
    expect(
      p({ spacing: { line: 360, lineRule: "exact" }, runDefaults: { fontFamily: "Calibri" } }).style
        .lineHeight,
    ).toBe("18pt");
  });

  it("lineRule=atLeast keeps natural leading (a minimum must never clip a taller line)", () => {
    const el = p({ spacing: { line: 360, lineRule: "atLeast" } });
    expect(el.style.lineHeight).toBe(""); // unset → natural leading
  });

  it("stamps data-page-break-before and data-keep-next", () => {
    expect(p({ pageBreakBefore: true }).hasAttribute("data-page-break-before")).toBe(true);
    expect(p({ keepNext: true }).hasAttribute("data-keep-next")).toBe(true);
    expect(p({}).hasAttribute("data-page-break-before")).toBe(false);
  });

  it("LI ignores paragraph left indent (UL padding owns it); non-LI keeps it", () => {
    const li = p({ indent: { leftTwips: 720 } }, [], "li");
    expect(li.style.marginLeft).toBe("");
    const para = p({ indent: { leftTwips: 720 } });
    expect(para.style.marginLeft).toBe("13mm"); // 720 twips ≈ 12.7 → 13
  });

  it("renders paragraph borders with mapped style + colour", () => {
    const el = p({
      borders: { bottom: { style: "single", sizeEighthsOfPt: 8, color: "FF0000" } },
    });
    // 8/8 pt × 96/72 = 1.33 → round 1px
    expect(el.style.borderBottom).toBe("1px solid rgb(255, 0, 0)");
  });

  it("maps border 'auto' colour to currentColor and double style", () => {
    const el = p({
      borders: { top: { style: "double", sizeEighthsOfPt: 24, color: "auto" } },
    });
    // jsdom normalises the `currentColor` keyword to lowercase.
    expect(el.style.borderTop).toBe("4px double currentcolor");
  });

  it("applies run-default font, colour, bold from the style cascade", () => {
    const styles: NamedStyle[] = [
      {
        id: "Heading1",
        type: "paragraph",
        displayName: "Heading 1",
        runDefaults: { fontFamily: "Cambria", color: "#2E74B5", bold: true },
      },
    ];
    const el = p({ styleId: "Heading1" }, styles);
    expect(el.style.fontFamily).toContain("Cambria");
    expect(el.style.color).toBe("rgb(46, 116, 181)");
    expect(el.style.fontWeight).toBe("bold");
  });

  it("paragraph's own runDefaults override the style cascade", () => {
    const styles: NamedStyle[] = [
      { id: "Normal", type: "paragraph", displayName: "Normal", runDefaults: { fontSizePt: 12 } },
    ];
    const el = p({ runDefaults: { fontSizePt: 8 } }, styles);
    expect(el.style.fontSize).toBe("8pt");
  });

  it("carries the style id verbatim in data-style-id for non-heading styles only", () => {
    expect(p({ styleId: "Footer" }).getAttribute("data-style-id")).toBe("Footer");
    expect(p({ styleId: "Heading2" }).getAttribute("data-style-id")).toBe(null);
    // Mixed case + spaces survive intact (would throw on classList.add).
    expect(p({ styleId: "Contact Information" }).getAttribute("data-style-id")).toBe(
      "Contact Information",
    );
  });
});
