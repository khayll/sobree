import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../doc/builders";
import type { Paragraph, SobreeDocument, TextRun } from "../doc/types";
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
