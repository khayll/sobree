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

  it("sets padding-left to the marker offset (left - hanging) and the hanging custom property", () => {
    const el = createListContainer(
      { numId: 1, ordered: false, leftTwips: 720, hangingTwips: 360 },
      0,
    );
    // (720 - 360) = 360 twips ≈ 6mm marker offset
    expect(el.style.paddingLeft).toBe("6mm");
    // hanging 360 twips ≈ 6mm
    expect(el.style.getPropertyValue("--sobree-list-hanging-mm")).toBe("6mm");
  });

  it("maps a known glyph to a native list-style-type keyword", () => {
    const el = createListContainer({ numId: 1, ordered: false, bulletGlyph: "▪" }, 0);
    expect(el.style.listStyleType).toBe("square");
    expect(el.classList.contains("sobree-list-custom-bullet")).toBe(false);
  });

  it("falls back to ::marker custom property for non-CSS glyphs", () => {
    const el = createListContainer({ numId: 1, ordered: false, bulletGlyph: "❖" }, 0);
    expect(el.style.listStyleType).toBe("none");
    expect(el.style.getPropertyValue("--sobree-bullet-glyph")).toBe('"❖"');
    expect(el.classList.contains("sobree-list-custom-bullet")).toBe(true);
  });

  it("stamps the section index", () => {
    expect(createListContainer({ numId: 1, ordered: false }, 3).dataset.sectionIndex).toBe("3");
  });
});
