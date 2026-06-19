import { describe, expect, it } from "vitest";
import type { Block, NamedStyle, NumberingDefinition } from "../../../doc/types";
import { computeOutlineNumbers, formatOrdinal } from "./outlineNumbering";

const NUMBERING: NumberingDefinition[] = [
  {
    numId: 14,
    abstractFormat: {
      levels: [
        { level: 0, format: "decimal", text: "%1" },
        { level: 1, format: "decimal", text: "%1.%2" },
        { level: 2, format: "decimal", text: "%1.%2.%3" },
      ],
    },
  },
];

const STYLES: NamedStyle[] = [
  { id: "Heading1", type: "paragraph", displayName: "Heading 1" },
  { id: "Heading2", type: "paragraph", displayName: "Heading 2" },
  { id: "Heading3", type: "paragraph", displayName: "Heading 3" },
  {
    id: "Head1",
    type: "paragraph",
    displayName: "Head1",
    basedOn: "Heading1",
    numbering: { numId: 14, level: 0 },
  },
  {
    id: "Head2",
    type: "paragraph",
    displayName: "Head2",
    basedOn: "Heading2",
    numbering: { numId: 14, level: 1 },
  },
  {
    id: "Head3",
    type: "paragraph",
    displayName: "Head3",
    basedOn: "Heading3",
    numbering: { numId: 14, level: 2 },
  },
];

const para = (styleId: string): Block => ({ kind: "paragraph", properties: { styleId }, runs: [] });

describe("computeOutlineNumbers", () => {
  it("numbers a multi-level heading sequence with per-level reset", () => {
    const blocks: Block[] = [
      para("Head1"), // 1
      para("Head2"), // 1.1
      para("Head2"), // 1.2
      para("Head3"), // 1.2.1
      para("Head1"), // 2     (resets level 1 + 2)
      para("Head2"), // 2.1
    ];
    const out = computeOutlineNumbers(blocks, STYLES, NUMBERING);
    expect([...out.values()]).toEqual(["1", "1.1", "1.2", "1.2.1", "2", "2.1"]);
  });

  it("ignores body text between headings (no counter bump)", () => {
    const blocks: Block[] = [
      para("Head1"), // 1
      para("Normal"), // —
      para("Head1"), // 2
    ];
    const out = computeOutlineNumbers(blocks, STYLES, NUMBERING);
    expect(out.get(0)).toBe("1");
    expect(out.has(1)).toBe(false);
    expect(out.get(2)).toBe("2");
  });

  it("does NOT number a non-heading style that links numbering (that's a list)", () => {
    const styles: NamedStyle[] = [
      {
        id: "ListParagraph",
        type: "paragraph",
        displayName: "List Paragraph",
        numbering: { numId: 14, level: 0 },
      },
    ];
    const out = computeOutlineNumbers([para("ListParagraph")], styles, NUMBERING);
    expect(out.size).toBe(0);
  });

  it("does NOT number a paragraph that carries its OWN (direct) numbering", () => {
    const block: Block = {
      kind: "paragraph",
      properties: { styleId: "Head1", numbering: { numId: 14, level: 0 } },
      runs: [],
    };
    expect(computeOutlineNumbers([block], STYLES, NUMBERING).size).toBe(0);
  });

  it("respects the level's numFmt + lvlText template", () => {
    const numbering: NumberingDefinition[] = [
      {
        numId: 9,
        abstractFormat: {
          levels: [{ level: 0, format: "upperRoman", text: "Chapter %1" }],
        },
      },
    ];
    const styles: NamedStyle[] = [
      { id: "Heading1", type: "paragraph", displayName: "Heading 1" },
      {
        id: "ChapterHead",
        type: "paragraph",
        displayName: "Chapter Head",
        basedOn: "Heading1",
        numbering: { numId: 9, level: 0 },
      },
    ];
    const out = computeOutlineNumbers(
      [para("ChapterHead"), para("ChapterHead")],
      styles,
      numbering,
    );
    expect([...out.values()]).toEqual(["Chapter I", "Chapter II"]);
  });
});

describe("formatOrdinal", () => {
  it("formats arabic / roman / letter", () => {
    expect(formatOrdinal(4, "decimal")).toBe("4");
    expect(formatOrdinal(4, "lowerRoman")).toBe("iv");
    expect(formatOrdinal(14, "upperRoman")).toBe("XIV");
    expect(formatOrdinal(1, "upperLetter")).toBe("A");
    expect(formatOrdinal(27, "lowerLetter")).toBe("aa");
    expect(formatOrdinal(3, "decimalZero")).toBe("03");
  });
});
