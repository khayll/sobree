import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../doc/builders";
import type { Paragraph, SobreeDocument, TextRun } from "../doc/types";
import { Editor } from "./";

/**
 * A paragraph-boundary Backspace/Delete (a MERGE) must run through the typed
 * API even when track-changes is OFF. Delegated to the browser's native
 * contentEditable, the merge is lossy — Chromium strips inline run formatting
 * (small-caps / colour / size) off the joined-in content, so a merged styled
 * line came back half-unstyled (the Field-Almanac copy/paste/backspace repro).
 */

const STYLE = { smallCaps: true, bold: true, color: "#F2A900", fontSizePt: 11 } as const;

function twoStyledLines(): SobreeDocument {
  const d = emptyDocument();
  d.body = [paragraph([text("Alpha", STYLE)]), paragraph([text("Beta", STYLE)])];
  return d;
}

function host(ed: Editor): HTMLElement {
  return (ed as unknown as { host: HTMLElement }).host;
}

function caret(ed: Editor, index: number, offset: number): void {
  const b = ed.getBlock(index);
  ed.selection.set({ kind: "caret", at: { block: { id: b.id, version: b.version }, offset } });
}

function fireBeforeInput(ed: Editor, inputType: string): void {
  const ev = new InputEvent("beforeinput", { inputType, bubbles: true, cancelable: true });
  host(ed).dispatchEvent(ev);
}

function textOf(p: Paragraph): string {
  return p.runs.map((r) => (r.kind === "text" ? r.text : "")).join("");
}

describe("paragraph-boundary merge preserves run formatting (untracked)", () => {
  it("Backspace at paragraph start merges into the previous line, keeping style", () => {
    const ed = new Editor(document.createElement("div"), { initialDocument: twoStyledLines() });
    document.body.appendChild(host(ed));
    caret(ed, 1, 0);

    fireBeforeInput(ed, "deleteContentBackward");

    const body = ed.getDocument().body as Paragraph[];
    expect(body).toHaveLength(1);
    expect(textOf(body[0]!)).toBe("AlphaBeta");
    // Every run of the merged line keeps the small-caps / colour / size —
    // the whole point: no half-unstyled tail.
    for (const run of body[0]!.runs) {
      const p = (run as TextRun).properties;
      expect(p.smallCaps).toBe(true);
      expect(p.color).toBe("#F2A900");
      expect(p.fontSizePt).toBe(11);
    }
    ed.destroy();
  });

  it("Delete at paragraph end merges the next line in, keeping style", () => {
    const ed = new Editor(document.createElement("div"), { initialDocument: twoStyledLines() });
    document.body.appendChild(host(ed));
    caret(ed, 0, 5); // end of "Alpha"

    fireBeforeInput(ed, "deleteContentForward");

    const body = ed.getDocument().body as Paragraph[];
    expect(body).toHaveLength(1);
    expect(textOf(body[0]!)).toBe("AlphaBeta");
    for (const run of body[0]!.runs) {
      expect((run as TextRun).properties.smallCaps).toBe(true);
    }
    ed.destroy();
  });

  it("a mid-line Backspace is left to the native path (not intercepted)", () => {
    const ed = new Editor(document.createElement("div"), { initialDocument: twoStyledLines() });
    document.body.appendChild(host(ed));
    caret(ed, 1, 2); // inside "Beta", not a boundary

    const ev = new InputEvent("beforeinput", {
      inputType: "deleteContentBackward",
      bubbles: true,
      cancelable: true,
    });
    host(ed).dispatchEvent(ev);

    // Not a merge, so our handler doesn't consume it — two blocks remain.
    expect(ev.defaultPrevented).toBe(false);
    expect(ed.getDocument().body).toHaveLength(2);
    ed.destroy();
  });
});
