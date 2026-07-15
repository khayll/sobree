import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../doc/builders";
import type { Paragraph, SobreeDocument, TextRun } from "../doc/types";
import { Editor } from "./";
import type { EditorContext } from "./context";
import { handleHtmlDrop } from "./ops/pasteDrop";
import { pasteHtmlAtCaret } from "./ops/pasteInsert";

/**
 * Model-first rich paste (Phase 3-5): clipboard HTML is parsed to AST and
 * inserted through the ops API, preserving formatting — no native
 * contentEditable + read-back. Drives `pasteHtmlAtCaret` directly (jsdom's
 * ClipboardEvent has no usable HTML DataTransfer).
 */

function ctxOf(ed: Editor): EditorContext {
  return (ed as unknown as { ctx: EditorContext }).ctx;
}

function editor(doc: SobreeDocument): Editor {
  const ed = new Editor(document.createElement("div"), { initialDocument: doc });
  document.body.appendChild((ed as unknown as { host: HTMLElement }).host);
  return ed;
}

function oneLine(s: string): SobreeDocument {
  const d = emptyDocument();
  d.body = [paragraph([text(s)])];
  return d;
}

function caret(ed: Editor, index: number, offset: number): void {
  const b = ed.getBlock(index);
  ed.selection.set({ kind: "caret", at: { block: { id: b.id, version: b.version }, offset } });
}

function textOf(p: Paragraph): string {
  return p.runs
    .map((r) => (r.kind === "text" ? r.text : r.kind === "hyperlink" ? "" : ""))
    .join("");
}

describe("model-first rich paste", () => {
  it("splices a single paragraph inline, keeping one block and the formatting", () => {
    const ed = editor(oneLine("Hello World"));
    caret(ed, 0, 5); // "Hello| World"

    pasteHtmlAtCaret(ctxOf(ed), "<b>BOLD</b>");

    const body = ed.getDocument().body as Paragraph[];
    expect(body).toHaveLength(1);
    expect(textOf(body[0]!)).toBe("HelloBOLD World");
    const bold = body[0]!.runs.find((r) => r.kind === "text" && r.text === "BOLD") as TextRun;
    expect(bold.properties.bold).toBe(true);
    ed.destroy();
  });

  it("splits the caret paragraph and merges first/last across a multi-paragraph paste", () => {
    const ed = editor(oneLine("HelloWorld"));
    caret(ed, 0, 5); // "Hello|World"

    pasteHtmlAtCaret(ctxOf(ed), "<p>A</p><p>B</p><p>C</p>");

    // "HelloA", "B", "CWorld"
    const body = ed.getDocument().body as Paragraph[];
    expect(body.map(textOf)).toEqual(["HelloA", "B", "CWorld"]);
    ed.destroy();
  });

  it("pastes a list, registering fresh numbering", () => {
    const ed = editor(oneLine("Intro"));
    caret(ed, 0, 5); // end

    pasteHtmlAtCaret(ctxOf(ed), "<ul><li>one</li><li>two</li></ul>");

    const doc = ed.getDocument();
    const listParas = (doc.body as Paragraph[]).filter((b) => b.properties?.numbering);
    expect(listParas).toHaveLength(2);
    // The pasted list's numId is registered in the document numbering.
    const numId = listParas[0]!.properties.numbering!.numId;
    expect(doc.numbering?.some((n) => n.numId === numId)).toBe(true);
    ed.destroy();
  });

  it("keeps a pasted heading as a heading block", () => {
    const ed = editor(oneLine("Body"));
    caret(ed, 0, 4); // end

    pasteHtmlAtCaret(ctxOf(ed), "<h2>Title</h2><p>after</p>");

    const body = ed.getDocument().body as Paragraph[];
    const heading = body.find((b) => b.properties?.styleId === "Heading2");
    expect(heading).toBeDefined();
    expect(textOf(heading!)).toBe("Title");
    ed.destroy();
  });

  it("replaces a selected range before inserting", () => {
    const ed = editor(oneLine("Hello"));
    const b = ed.getBlock(0);
    ed.selection.set({
      kind: "range",
      range: {
        from: { block: { id: b.id, version: b.version }, offset: 0 },
        to: { block: { id: b.id, version: b.version }, offset: 5 },
      },
    });

    pasteHtmlAtCaret(ctxOf(ed), "<b>New</b>");

    expect(textOf(ed.getDocument().body[0] as Paragraph)).toBe("New");
    ed.destroy();
  });

  it("stamps pasted runs as ins in tracked mode", () => {
    const ed = editor(oneLine("Doc"));
    ed.setTrackChanges({ enabled: true, author: "A" });
    caret(ed, 0, 3); // end

    pasteHtmlAtCaret(ctxOf(ed), "<b>added</b>");

    const body = ed.getDocument().body as Paragraph[];
    const added = body[0]!.runs.find((r) => r.kind === "text" && r.text === "added") as TextRun;
    expect(added.properties.revision?.type).toBe("ins");
    ed.destroy();
  });

  it("returns false for empty / unusable HTML", () => {
    const ed = editor(oneLine("x"));
    caret(ed, 0, 1);
    expect(pasteHtmlAtCaret(ctxOf(ed), "<meta charset='utf-8'>")).toBe(false);
    ed.destroy();
  });
});

/** A DragEvent stub — jsdom has no layout, so `caretRangeFromPoint` returns null
 *  and the drop falls back to the current selection (which the test sets). */
function dropEvent(html: string, plain = ""): DragEvent {
  const dt = {
    types: [html ? "text/html" : "", plain ? "text/plain" : ""].filter(Boolean),
    files: [] as unknown,
    items: [] as unknown,
    getData: (t: string) => (t === "text/html" ? html : t === "text/plain" ? plain : ""),
  };
  return {
    dataTransfer: dt,
    clientX: 0,
    clientY: 0,
    preventDefault() {},
  } as unknown as DragEvent;
}

describe("model-first drop", () => {
  it("inserts a dropped HTML fragment at the caret via the API", () => {
    const ed = editor(oneLine("Hello"));
    caret(ed, 0, 5);

    expect(handleHtmlDrop(ctxOf(ed), dropEvent("<b>DROP</b>"))).toBe(true);
    expect(textOf(ed.getDocument().body[0] as Paragraph)).toBe("HelloDROP");
    ed.destroy();
  });

  it("wraps a plain-text drop into paragraphs", () => {
    const ed = editor(oneLine("X"));
    caret(ed, 0, 1);

    handleHtmlDrop(ctxOf(ed), dropEvent("", "a\nb"));

    const texts = (ed.getDocument().body as Paragraph[]).map(textOf);
    expect(texts).toEqual(["Xa", "b"]);
    ed.destroy();
  });

  it("falls through (returns false) for an image drop", () => {
    const ed = editor(oneLine("x"));
    const dt = {
      types: ["Files"],
      files: [{ type: "image/png" }],
      items: [],
      getData: () => "",
    };
    const ev = { dataTransfer: dt, preventDefault() {} } as unknown as DragEvent;

    expect(handleHtmlDrop(ctxOf(ed), ev)).toBe(false);
    ed.destroy();
  });
});
