/**
 * Tests `readSelectionState` against a fixture document, exercising:
 *   - cascade-resolved fontFamily / fontSizePt / bold for headings
 *   - intersection of run props across a multi-run range
 *   - list-format detection (bullet vs decimal)
 *   - graceful EMPTY_STATE when no caret
 *
 * Uses a hand-built minimal Editor stub that satisfies the public
 * surface readSelectionState reaches for: getDocument, getBlockById,
 * selection.currentCaret, selection.currentRange. No real editor mount
 * needed — the function is pure relative to those inputs.
 */
import { describe, expect, it } from "vitest";
import { readSelectionState } from "./selectionState";
import { defaultStyles } from "@sobree/core";
import type {
  Editor,
  Paragraph,
  SobreeDocument,
  Range as ApiRange,
  InlinePosition,
} from "@sobree/core";

function makeStub(opts: {
  doc: SobreeDocument;
  caretAt: { blockIndex: number; offset: number } | null;
  range?: ApiRange | null;
}): Editor {
  const { doc, caretAt, range } = opts;
  const blockId = (idx: number) => `b${idx + 1}`;
  return {
    getDocument: () => doc,
    getBlockById: (id: string) => {
      const idx = Number(id.slice(1)) - 1;
      const block = doc.body[idx];
      if (!block) return null;
      if (block.kind !== "paragraph") {
        return { index: idx, id, version: 1, kind: block.kind, text: "", length: 0 };
      }
      const text = block.runs
        .map((r) => (r.kind === "text" ? r.text : ""))
        .join("");
      return {
        index: idx,
        id,
        version: 1,
        kind: "paragraph",
        text,
        length: text.length,
      };
    },
    selection: {
      currentCaret: (): InlinePosition | null =>
        caretAt
          ? { block: { id: blockId(caretAt.blockIndex), version: 1 }, offset: caretAt.offset }
          : null,
      currentRange: (): ApiRange | null => range ?? null,
    },
  } as unknown as Editor;
}

function para(...text: string[]): Paragraph {
  return {
    kind: "paragraph",
    properties: {},
    runs: text.map((t) => ({ kind: "text", text: t, properties: {} })),
  };
}

function makeDoc(body: Paragraph[]): SobreeDocument {
  return {
    body,
    sections: [],
    headerFooterBodies: {},
    styles: defaultStyles(),
    numbering: [],
    rawParts: {},
    relationships: { byId: {} },
  } as unknown as SobreeDocument;
}

describe("readSelectionState — empty / unfocused", () => {
  it("returns EMPTY_STATE when no caret", () => {
    const doc = makeDoc([para("hi")]);
    const editor = makeStub({ doc, caretAt: null });
    const state = readSelectionState(editor);
    expect(state.blockKind).toBeNull();
    expect(state.runProps).toEqual({});
  });
});

describe("readSelectionState — cascade resolution", () => {
  it("Heading1 reports Helvetica 24pt bold from the cascade", () => {
    const h1: Paragraph = {
      kind: "paragraph",
      properties: { styleId: "Heading1" },
      runs: [{ kind: "text", text: "Title", properties: {} }],
    };
    const doc = makeDoc([h1]);
    const state = readSelectionState(makeStub({ doc, caretAt: { blockIndex: 0, offset: 0 } }));
    expect(state.runProps).toMatchObject({
      bold: true,
      fontFamily: "Helvetica",
      fontSizePt: 24,
    });
    expect(state.paragraphProps?.styleId).toBe("Heading1");
  });

  it("plain paragraph reports Helvetica 11pt from Normal", () => {
    const doc = makeDoc([para("hello")]);
    const state = readSelectionState(makeStub({ doc, caretAt: { blockIndex: 0, offset: 0 } }));
    expect(state.runProps).toMatchObject({
      fontFamily: "Helvetica",
      fontSizePt: 11,
    });
    expect(state.runProps.bold).toBeUndefined();
  });

  it("explicit run override wins over cascade", () => {
    const p: Paragraph = {
      kind: "paragraph",
      properties: {},
      runs: [
        { kind: "text", text: "big", properties: { fontSizePt: 24, italic: true } },
      ],
    };
    const doc = makeDoc([p]);
    const state = readSelectionState(makeStub({ doc, caretAt: { blockIndex: 0, offset: 1 } }));
    expect(state.runProps.fontSizePt).toBe(24);
    expect(state.runProps.italic).toBe(true);
    // Cascade still supplies fontFamily.
    expect(state.runProps.fontFamily).toBe("Helvetica");
  });
});

describe("readSelectionState — range intersection", () => {
  it("range across two runs that disagree on fontSize drops the value", () => {
    const p: Paragraph = {
      kind: "paragraph",
      properties: {},
      runs: [
        { kind: "text", text: "AAAA", properties: { fontSizePt: 12 } },
        { kind: "text", text: "BBBB", properties: { fontSizePt: 18 } },
      ],
    };
    const doc = makeDoc([p]);
    const range: ApiRange = {
      from: { block: { id: "b1", version: 1 }, offset: 0 },
      to: { block: { id: "b1", version: 1 }, offset: 8 },
    };
    const state = readSelectionState(
      makeStub({ doc, caretAt: { blockIndex: 0, offset: 0 }, range }),
    );
    // fontSizePt disagrees → omitted (cascade still supplies its own
    // value, but ownRunProps is empty for the disagreement, so
    // cascade's 11pt shows through).
    expect(state.runProps.fontSizePt).toBe(11);
  });

  it("range over runs that agree keeps the shared value", () => {
    const p: Paragraph = {
      kind: "paragraph",
      properties: {},
      runs: [
        { kind: "text", text: "AAAA", properties: { bold: true } },
        { kind: "text", text: "BBBB", properties: { bold: true, italic: true } },
      ],
    };
    const doc = makeDoc([p]);
    const range: ApiRange = {
      from: { block: { id: "b1", version: 1 }, offset: 0 },
      to: { block: { id: "b1", version: 1 }, offset: 8 },
    };
    const state = readSelectionState(
      makeStub({ doc, caretAt: { blockIndex: 0, offset: 0 }, range }),
    );
    expect(state.runProps.bold).toBe(true);
    // italic not on every run -> dropped
    expect(state.runProps.italic).toBeUndefined();
  });
});

describe("readSelectionState — list format", () => {
  it("detects bullet numbering", () => {
    const li: Paragraph = {
      kind: "paragraph",
      properties: { numbering: { numId: 1, level: 0 } },
      runs: [{ kind: "text", text: "item", properties: {} }],
    };
    const doc = makeDoc([li]);
    doc.numbering = [
      {
        numId: 1,
        abstractFormat: { levels: [{ level: 0, format: "bullet", text: "•" }] },
      },
    ];
    const state = readSelectionState(makeStub({ doc, caretAt: { blockIndex: 0, offset: 0 } }));
    expect(state.listFormat).toBe("bullet");
  });

  it("detects decimal (numbered) lists", () => {
    const li: Paragraph = {
      kind: "paragraph",
      properties: { numbering: { numId: 2, level: 0 } },
      runs: [{ kind: "text", text: "item", properties: {} }],
    };
    const doc = makeDoc([li]);
    doc.numbering = [
      {
        numId: 2,
        abstractFormat: { levels: [{ level: 0, format: "decimal", text: "%1." }] },
      },
    ];
    const state = readSelectionState(makeStub({ doc, caretAt: { blockIndex: 0, offset: 0 } }));
    expect(state.listFormat).toBe("decimal");
  });
});
