import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, table, tableCell, tableRow, text } from "../doc/builders";
import type { Paragraph, SobreeDocument, Table, TextRun } from "../doc/types";
import { Editor } from "./";

/**
 * Untracked text insertion is model-first (Phase 3-2 of
 * `devdocs/plan-model-first-editing.md`): `insertText` / `insertReplacementText`
 * are intercepted at `beforeinput` and routed through the typed ops API, so the
 * AST mutates directly and the DOM is re-rendered from it — no native
 * contentEditable mutation + `syncFromDom` read-back. Composition (IME) is
 * explicitly left on the native path.
 *
 * These dispatch a real `beforeinput` at the host (the wiring entry point) and
 * `preventDefault` cancels the browser's native insert — so any resulting text
 * in the AST can ONLY have come from the API path.
 */

function host(ed: Editor): HTMLElement {
  return (ed as unknown as { host: HTMLElement }).host;
}

function oneLine(s = "Hello"): SobreeDocument {
  const d = emptyDocument();
  d.body = [paragraph([text(s)])];
  return d;
}

function caret(ed: Editor, index: number, offset: number): void {
  const b = ed.getBlock(index);
  ed.selection.set({ kind: "caret", at: { block: { id: b.id, version: b.version }, offset } });
}

function fire(ed: Editor, init: InputEventInit): InputEvent {
  const ev = new InputEvent("beforeinput", { bubbles: true, cancelable: true, ...init });
  host(ed).dispatchEvent(ev);
  return ev;
}

function textOf(p: Paragraph): string {
  return p.runs.map((r) => (r.kind === "text" ? r.text : "")).join("");
}

describe("untracked insertText is model-first (Phase 3-2)", () => {
  it("routes insertText through the API as a plain (unmarked) run", () => {
    const ed = new Editor(document.createElement("div"), { initialDocument: oneLine() });
    document.body.appendChild(host(ed));
    caret(ed, 0, 5); // end of "Hello"

    const ev = fire(ed, { inputType: "insertText", data: "!" });

    // Consumed → the browser's native insert was cancelled; the text below can
    // only be from the API.
    expect(ev.defaultPrevented).toBe(true);
    const body = ed.getDocument().body as Paragraph[];
    expect(textOf(body[0]!)).toBe("Hello!");
    // Untracked ⇒ no revision marker.
    for (const r of body[0]!.runs) {
      expect((r as TextRun).properties.revision).toBeUndefined();
    }
    // The DOM was re-rendered from the AST (model-first), not left to native.
    expect(host(ed).textContent).toContain("Hello!");
    ed.destroy();
  });

  it("types over a selected range (replaces it)", () => {
    const ed = new Editor(document.createElement("div"), { initialDocument: oneLine("Hello") });
    document.body.appendChild(host(ed));
    const b = ed.getBlock(0);
    ed.selection.set({
      kind: "range",
      range: {
        from: { block: { id: b.id, version: b.version }, offset: 0 },
        to: { block: { id: b.id, version: b.version }, offset: 5 },
      },
    });

    const ev = fire(ed, { inputType: "insertText", data: "Bye" });

    expect(ev.defaultPrevented).toBe(true);
    expect(textOf(ed.getDocument().body[0] as Paragraph)).toBe("Bye");
    ed.destroy();
  });

  it("inherits the formatting under the caret (typing continues the run's style)", () => {
    // The native path inherited implicitly (browser typed into the styled span);
    // the API insert must reproduce it or a styled run comes out plain.
    const d = emptyDocument();
    d.body = [paragraph([text("Hi", { bold: true, color: "#F2A900", smallCaps: true })])];
    const ed = new Editor(document.createElement("div"), { initialDocument: d });
    document.body.appendChild(host(ed));
    caret(ed, 0, 2); // end of the styled run

    fire(ed, { inputType: "insertText", data: "!" });

    const runsOut = (ed.getDocument().body[0] as Paragraph).runs as TextRun[];
    expect(textOf(ed.getDocument().body[0] as Paragraph)).toBe("Hi!");
    // Merged into the styled run ⇒ one run, formatting intact.
    for (const r of runsOut) {
      expect(r.properties.bold).toBe(true);
      expect(r.properties.color).toBe("#F2A900");
      expect(r.properties.smallCaps).toBe(true);
    }
    ed.destroy();
  });

  it("inherits from the char to the LEFT at a formatting boundary", () => {
    const d = emptyDocument();
    d.body = [paragraph([text("ab", { bold: true }), text("cd", { italic: true })])];
    const ed = new Editor(document.createElement("div"), { initialDocument: d });
    document.body.appendChild(host(ed));
    caret(ed, 0, 2); // between the bold and italic runs → continues BOLD

    fire(ed, { inputType: "insertText", data: "X" });

    const body = ed.getDocument().body[0] as Paragraph;
    const x = body.runs.find((r) => (r as TextRun).text.includes("X")) as TextRun;
    expect(x.properties.bold).toBe(true);
    expect(x.properties.italic).toBeUndefined();
    ed.destroy();
  });

  it("leaves IME composition to the native path", () => {
    const ed = new Editor(document.createElement("div"), { initialDocument: oneLine() });
    document.body.appendChild(host(ed));
    caret(ed, 0, 5);

    // Composition surfaces as insertCompositionText — must NOT be intercepted.
    const ev = fire(ed, { inputType: "insertCompositionText", data: "あ" });

    expect(ev.defaultPrevented).toBe(false);
    ed.destroy();
  });

  it("stamps an ins run when tracked mode is on (still routed via the tracked path)", () => {
    const ed = new Editor(document.createElement("div"), { initialDocument: oneLine() });
    document.body.appendChild(host(ed));
    ed.setTrackChanges({ enabled: true, author: "A" });
    caret(ed, 0, 5);

    const ev = fire(ed, { inputType: "insertText", data: "X" });

    expect(ev.defaultPrevented).toBe(true);
    const body = ed.getDocument().body as Paragraph[];
    expect(textOf(body[0]!)).toBe("HelloX");
    const inserted = body[0]!.runs.find((r) => (r as TextRun).text === "X") as TextRun;
    expect(inserted.properties.revision?.type).toBe("ins");
    ed.destroy();
  });
});

describe("untracked char deletes are model-first (Phase 3-3)", () => {
  it("deleteContentBackward removes the char before the caret via the API", () => {
    const ed = new Editor(document.createElement("div"), { initialDocument: oneLine("Hello") });
    document.body.appendChild(host(ed));
    caret(ed, 0, 5); // end of "Hello"

    const ev = fire(ed, { inputType: "deleteContentBackward" });

    expect(ev.defaultPrevented).toBe(true);
    expect(textOf(ed.getDocument().body[0] as Paragraph)).toBe("Hell");
    ed.destroy();
  });

  it("deleteContentForward removes the char after the caret via the API", () => {
    const ed = new Editor(document.createElement("div"), { initialDocument: oneLine("Hello") });
    document.body.appendChild(host(ed));
    caret(ed, 0, 0); // start

    const ev = fire(ed, { inputType: "deleteContentForward" });

    expect(ev.defaultPrevented).toBe(true);
    expect(textOf(ed.getDocument().body[0] as Paragraph)).toBe("ello");
    ed.destroy();
  });

  it("Backspace over a selection deletes the range", () => {
    const ed = new Editor(document.createElement("div"), { initialDocument: oneLine("Hello") });
    document.body.appendChild(host(ed));
    const b = ed.getBlock(0);
    ed.selection.set({
      kind: "range",
      range: {
        from: { block: { id: b.id, version: b.version }, offset: 1 },
        to: { block: { id: b.id, version: b.version }, offset: 4 },
      },
    });

    const ev = fire(ed, { inputType: "deleteContentBackward" });

    expect(ev.defaultPrevented).toBe(true);
    expect(textOf(ed.getDocument().body[0] as Paragraph)).toBe("Ho");
    ed.destroy();
  });

  it("deleteWordBackward removes the whole word before the caret", () => {
    const ed = new Editor(document.createElement("div"), { initialDocument: oneLine("foo bar") });
    document.body.appendChild(host(ed));
    caret(ed, 0, 7); // end

    const ev = fire(ed, { inputType: "deleteWordBackward" });

    expect(ev.defaultPrevented).toBe(true);
    expect(textOf(ed.getDocument().body[0] as Paragraph)).toBe("foo ");
    ed.destroy();
  });

  it("deleteWordForward removes the whole word after the caret", () => {
    const ed = new Editor(document.createElement("div"), { initialDocument: oneLine("foo bar") });
    document.body.appendChild(host(ed));
    caret(ed, 0, 0); // start

    const ev = fire(ed, { inputType: "deleteWordForward" });

    expect(ev.defaultPrevented).toBe(true);
    expect(textOf(ed.getDocument().body[0] as Paragraph)).toBe(" bar");
    ed.destroy();
  });

  it("deletes only ONE word, stopping at the preceding space", () => {
    const ed = new Editor(document.createElement("div"), {
      initialDocument: oneLine("hello world foo"),
    });
    document.body.appendChild(host(ed));
    caret(ed, 0, 15); // end

    fire(ed, { inputType: "deleteWordBackward" });

    expect(textOf(ed.getDocument().body[0] as Paragraph)).toBe("hello world ");
    ed.destroy();
  });

  it("deleteByCut removes the selected range", () => {
    const ed = new Editor(document.createElement("div"), { initialDocument: oneLine("Hello") });
    document.body.appendChild(host(ed));
    const b = ed.getBlock(0);
    ed.selection.set({
      kind: "range",
      range: {
        from: { block: { id: b.id, version: b.version }, offset: 1 },
        to: { block: { id: b.id, version: b.version }, offset: 4 },
      },
    });

    const ev = fire(ed, { inputType: "deleteByCut" });

    expect(ev.defaultPrevented).toBe(true);
    expect(textOf(ed.getDocument().body[0] as Paragraph)).toBe("Ho");
    ed.destroy();
  });
});

describe("table cells are editable through the ops", () => {
  /** One table, one cell, one paragraph — the addressable shape. */
  function tableDoc(): SobreeDocument {
    const d = emptyDocument();
    d.body = [table([tableRow([tableCell([paragraph([text("cell")])])])])];
    return d;
  }

  function cellCaret(ed: Editor, offset: number): void {
    const b = ed.getBlock(0);
    ed.selection.set({
      kind: "caret",
      at: {
        block: { id: b.id, version: b.version },
        offset,
        cell: { row: 0, col: 0, blockIndex: 0 },
      },
    });
  }

  function cellParagraph(ed: Editor, row = 0, col = 0): Paragraph {
    const t = ed.getDocument().body[0] as Table;
    return t.rows[row]!.cells[col]!.content[0] as Paragraph;
  }

  it("types into the cell's own paragraph", () => {
    const ed = new Editor(document.createElement("div"), { initialDocument: tableDoc() });
    document.body.appendChild(host(ed));
    cellCaret(ed, 4);

    const ev = fire(ed, { inputType: "insertText", data: "Z" });

    expect(ev.defaultPrevented).toBe(true);
    expect(textOf(cellParagraph(ed))).toBe("cellZ");
    ed.destroy();
  });

  it("deletes backward inside the cell", () => {
    const ed = new Editor(document.createElement("div"), { initialDocument: tableDoc() });
    document.body.appendChild(host(ed));
    cellCaret(ed, 4);

    fire(ed, { inputType: "deleteContentBackward" });

    expect(textOf(cellParagraph(ed))).toBe("cel");
    ed.destroy();
  });

  it("RECORDS a tracked insert in a cell rather than dropping the keystroke", () => {
    // The reported gap: tracked-mode typing in a cell was consumed and
    // silently dropped, so cells were uneditable with track changes ON.
    const ed = new Editor(document.createElement("div"), { initialDocument: tableDoc() });
    document.body.appendChild(host(ed));
    ed.setTrackChanges({ enabled: true, author: "Ada" });
    cellCaret(ed, 4);

    const ev = fire(ed, { inputType: "insertText", data: "Z" });

    expect(ev.defaultPrevented).toBe(true);
    const runs = cellParagraph(ed).runs as TextRun[];
    const inserted = runs.find((r) => r.text === "Z");
    // …and it's MARKED — falling through to native would have typed an
    // untracked character, which for track changes is silent data loss.
    expect(inserted?.properties.revision).toEqual({ type: "ins", author: "Ada" });
    ed.destroy();
  });

  it("writes to the cell the ADDRESS names, not the one at that rendered index", () => {
    const ed = new Editor(document.createElement("div"), {
      initialDocument: (() => {
        const d = emptyDocument();
        d.body = [
          table([
            tableRow([tableCell([paragraph([text("a")])]), tableCell([paragraph([text("b")])])]),
          ]),
        ];
        return d;
      })(),
    });
    document.body.appendChild(host(ed));
    const b = ed.getBlock(0);
    ed.selection.set({
      kind: "caret",
      at: {
        block: { id: b.id, version: b.version },
        offset: 1,
        cell: { row: 0, col: 1, blockIndex: 0 },
      },
    });

    fire(ed, { inputType: "insertText", data: "!" });

    expect(textOf(cellParagraph(ed, 0, 1))).toBe("b!");
    expect(textOf(cellParagraph(ed, 0, 0))).toBe("a"); // untouched
    ed.destroy();
  });

  it("declines insertParagraph in a cell (structural — stays native)", () => {
    // `splitBlock` splices `doc.body`; a cell paragraph isn't in it. Declining
    // leaves the native path to handle Enter, as before.
    const ed = new Editor(document.createElement("div"), { initialDocument: tableDoc() });
    document.body.appendChild(host(ed));
    cellCaret(ed, 2);

    const ev = fire(ed, { inputType: "insertParagraph" });

    expect(ev.defaultPrevented).toBe(false);
    ed.destroy();
  });

  it("declines a range that spans two cells", () => {
    // Both endpoints share the TABLE's block id, so a same-block delete would
    // otherwise rewrite one cell's runs using the other cell's offsets.
    const ed = new Editor(document.createElement("div"), { initialDocument: tableDoc() });
    document.body.appendChild(host(ed));
    const b = ed.getBlock(0);
    ed.selection.set({
      kind: "range",
      range: {
        from: {
          block: { id: b.id, version: b.version },
          offset: 1,
          cell: { row: 0, col: 0, blockIndex: 0 },
        },
        to: {
          block: { id: b.id, version: b.version },
          offset: 1,
          cell: { row: 0, col: 1, blockIndex: 0 },
        },
      },
    });

    const ev = fire(ed, { inputType: "deleteContentBackward" });

    expect(ev.defaultPrevented).toBe(false);
    expect(textOf(cellParagraph(ed))).toBe("cell");
    ed.destroy();
  });

  it("declines a cell whose content isn't addressable by index (a list)", () => {
    // `renderBlocks` groups numbered paragraphs into one <ul>, so the rendered
    // child index no longer maps onto `cell.content` — guessing would edit the
    // wrong paragraph.
    const listPara = paragraph([text("one")]);
    listPara.properties.numbering = { numId: 1, level: 0 };
    const d = emptyDocument();
    d.body = [table([tableRow([tableCell([listPara])])])];
    const ed = new Editor(document.createElement("div"), { initialDocument: d });
    document.body.appendChild(host(ed));
    cellCaret(ed, 3);

    const ev = fire(ed, { inputType: "insertText", data: "Z" });

    expect(ev.defaultPrevented).toBe(false);
    ed.destroy();
  });
});

describe("untracked Enter / line break are model-first (Phase 3-4)", () => {
  it("insertParagraph splits the paragraph at the caret via the API", () => {
    const ed = new Editor(document.createElement("div"), {
      initialDocument: oneLine("HelloWorld"),
    });
    document.body.appendChild(host(ed));
    caret(ed, 0, 5); // between "Hello" and "World"

    const ev = fire(ed, { inputType: "insertParagraph" });

    expect(ev.defaultPrevented).toBe(true);
    const body = ed.getDocument().body as Paragraph[];
    expect(body).toHaveLength(2);
    expect(textOf(body[0]!)).toBe("Hello");
    expect(textOf(body[1]!)).toBe("World");
    // Untracked ⇒ the new paragraph mark is not a tracked insert.
    expect(body[1]!.properties.revision).toBeUndefined();
    ed.destroy();
  });

  it("insertLineBreak inserts a plain soft break run via the API", () => {
    const ed = new Editor(document.createElement("div"), { initialDocument: oneLine("AB") });
    document.body.appendChild(host(ed));
    caret(ed, 0, 1); // between A and B

    const ev = fire(ed, { inputType: "insertLineBreak" });

    expect(ev.defaultPrevented).toBe(true);
    const p = ed.getDocument().body[0] as Paragraph;
    // Still one block, now with a line break between A and B.
    expect(ed.getDocument().body).toHaveLength(1);
    const br = p.runs.find((r) => r.kind === "break");
    expect(br).toBeDefined();
    expect((br as { properties: { revision?: unknown } }).properties.revision).toBeUndefined();
    ed.destroy();
  });

  it("stamps the split's new paragraph as ins when tracked", () => {
    const ed = new Editor(document.createElement("div"), {
      initialDocument: oneLine("HelloWorld"),
    });
    document.body.appendChild(host(ed));
    ed.setTrackChanges({ enabled: true, author: "A" });
    caret(ed, 0, 5);

    const ev = fire(ed, { inputType: "insertParagraph" });

    expect(ev.defaultPrevented).toBe(true);
    const body = ed.getDocument().body as Paragraph[];
    expect(body[1]!.properties.revision?.type).toBe("ins");
    ed.destroy();
  });
});
