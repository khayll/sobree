import { describe, expect, it } from "vitest";

import type { Block, NumberingDefinition } from "../../../doc/types";
import { createListContainer, paragraphListInfo } from "./lists";

function bulletNumbering(numId: number, glyph: string, leftTwips = 720, hangingTwips = 360): NumberingDefinition {
  return {
    numId,
    abstractFormat: {
      levels: [
        {
          level: 0,
          format: "bullet",
          text: glyph,
          paragraphIndent: { leftTwips, hangingTwips },
        },
      ],
    },
  };
}

function listParagraph(numId: number, level = 0): Block {
  return {
    kind: "paragraph",
    runs: [{ kind: "text", text: "item", properties: {} }],
    properties: { numbering: { numId, level } },
  };
}

describe("paragraphListInfo", () => {
  it("returns null for non-list paragraphs", () => {
    expect(paragraphListInfo({ kind: "paragraph", runs: [], properties: {} }, [])).toBeNull();
  });

  it("treats an unknown numId as an ordered list with no glyph (missing level → format !== 'bullet')", () => {
    // Preserved behaviour: a paragraph carrying a `numbering` property
    // is always a list item; if the numId isn't in the table the level
    // is undefined, so `format !== "bullet"` resolves to ordered. (A
    // future hardening could return null here, but that's a behaviour
    // change, not a refactor.)
    expect(paragraphListInfo(listParagraph(9), [bulletNumbering(1, "•")])).toEqual({
      numId: 9,
      ordered: true,
      counterStyle: "decimal",
      markerPrefix: "",
      markerSuffix: ".",
    });
  });

  it("derives ordered counter-style + lvlText affixes", () => {
    const num: NumberingDefinition = {
      numId: 3,
      abstractFormat: { levels: [{ level: 0, format: "lowerLetter", text: "(%1)" }] },
    };
    expect(paragraphListInfo(listParagraph(3), [num])).toMatchObject({
      ordered: true,
      counterStyle: "lower-latin",
      markerPrefix: "(",
      markerSuffix: ")",
    });
  });

  it("reads ordered vs bulleted, indent, and glyph", () => {
    const info = paragraphListInfo(listParagraph(1), [bulletNumbering(1, "❖", 720, 360)]);
    expect(info).toEqual({
      numId: 1,
      ordered: false,
      leftTwips: 720,
      hangingTwips: 360,
      bulletGlyph: "❖",
    });
  });

  it("marks decimal/non-bullet formats as ordered with no glyph", () => {
    const num: NumberingDefinition = {
      numId: 2,
      abstractFormat: { levels: [{ level: 0, format: "decimal", text: "%1." }] },
    };
    const info = paragraphListInfo(listParagraph(2), [num]);
    expect(info?.ordered).toBe(true);
    expect(info?.bulletGlyph).toBeUndefined();
  });
});

describe("createListContainer", () => {
  it("builds <ul> for bullets and <ol> for ordered", () => {
    expect(createListContainer({ numId: 1, ordered: false }, 0).tagName).toBe("UL");
    expect(createListContainer({ numId: 1, ordered: true }, 0).tagName).toBe("OL");
  });

  it("sets padding-left to the text column (left) and --sobree-list-hang to the marker-box width (hanging)", () => {
    const el = createListContainer(
      { numId: 1, ordered: false, leftTwips: 720, hangingTwips: 360 },
      0,
    );
    // text column at `left` = 720 twips ≈ 13mm; marker box = hanging 360 ≈ 6mm
    expect(el.style.paddingLeft).toBe("13mm");
    expect(el.style.getPropertyValue("--sobree-list-hang")).toBe("6mm");
    expect(el.classList.contains("sobree-hang")).toBe(true);
  });

  it("renders any bullet glyph via --sobree-bullet + the lst-bullet class (no native marker)", () => {
    for (const glyph of ["▪", "❖", "•"]) {
      const el = createListContainer({ numId: 1, ordered: false, bulletGlyph: glyph }, 0);
      expect(el.classList.contains("lst-bullet")).toBe(true);
      expect(el.style.getPropertyValue("--sobree-bullet")).toBe(`"${glyph}"`);
      expect(el.style.listStyleType).toBe("");
    }
  });

  it("sets the ordered counter-style class + marker affixes", () => {
    const el = createListContainer(
      { numId: 2, ordered: true, counterStyle: "decimal", markerPrefix: "", markerSuffix: "." },
      0,
    );
    expect(el.tagName).toBe("OL");
    expect(el.classList.contains("lst-decimal")).toBe(true);
    expect(el.style.getPropertyValue("--mk-suf")).toBe('"."');
  });

  it("stamps the section index", () => {
    expect(createListContainer({ numId: 1, ordered: false }, 3).dataset.sectionIndex).toBe("3");
  });
});
