/**
 * End-to-end History tests against a real Editor mounted in jsdom.
 * Exercises the integration between Editor.commit + History plus the
 * undo/redo round-trip.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../doc/builders";
import { Editor } from "./index";

let host: HTMLElement;
let editor: Editor;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  const doc = emptyDocument();
  doc.body = [paragraph([text("hello")]), paragraph([text("world")])];
  editor = new Editor(host, { initialDocument: doc });
});

afterEach(() => {
  editor.destroy();
  host.remove();
});

describe("History — initial state", () => {
  it("has nothing to undo or redo on a fresh editor", () => {
    expect(editor.history.canUndo()).toBe(false);
    expect(editor.history.canRedo()).toBe(false);
    expect(editor.history.depth()).toEqual({ undo: 0, redo: 0 });
  });
});

describe("History — AST mutations", () => {
  it("setDocument is undoable", () => {
    const before = editor.getDocument();
    const next = emptyDocument();
    next.body = [paragraph([text("replaced")])];
    editor.setDocument(next);

    expect(editor.history.canUndo()).toBe(true);
    expect(editor.getDocument().body[0]).not.toBe(before.body[0]);

    expect(editor.history.undo()).toBe(true);
    expect(editor.getDocument().body[0]?.kind).toBe("paragraph");
    expect((editor.getDocument().body[0] as { runs: unknown[] }).runs).toEqual(
      before.body[0]?.kind === "paragraph" ? before.body[0].runs : [],
    );
  });

  it("redo restores an undone change", () => {
    const next = emptyDocument();
    next.body = [paragraph([text("after-undo-redo")])];
    editor.setDocument(next);

    expect(editor.history.undo()).toBe(true);
    expect(editor.history.canRedo()).toBe(true);
    expect(editor.history.redo()).toBe(true);
    const head = editor.getDocument().body[0];
    expect(head?.kind).toBe("paragraph");
    expect(head?.kind === "paragraph" ? head.runs[0] : null).toEqual({
      kind: "text",
      text: "after-undo-redo",
      properties: {},
    });
  });

  it("a new commit clears the redo stack", () => {
    const docA = emptyDocument();
    docA.body = [paragraph([text("a")])];
    const docB = emptyDocument();
    docB.body = [paragraph([text("b")])];
    const docC = emptyDocument();
    docC.body = [paragraph([text("c")])];

    editor.setDocument(docA);
    editor.setDocument(docB);
    editor.history.undo(); // back to docA
    expect(editor.history.canRedo()).toBe(true);
    editor.setDocument(docC); // new commit — redo dies
    expect(editor.history.canRedo()).toBe(false);
  });

  it("undo on an empty stack returns false", () => {
    expect(editor.history.undo()).toBe(false);
    expect(editor.history.redo()).toBe(false);
  });
});

describe("History — depth + listeners", () => {
  it("fires change listeners on push / undo / redo", () => {
    const events: Array<{ undo: number; redo: number }> = [];
    const off = editor.history.on("change", (d) => events.push({ ...d }));
    const next = emptyDocument();
    next.body = [paragraph([text("x")])];
    editor.setDocument(next);
    editor.history.undo();
    editor.history.redo();
    off();
    // Three events at minimum: push, undo, redo. Some ordering may
    // include extra fires from typing-flushes — assert the highlights.
    expect(events.length).toBeGreaterThanOrEqual(3);
    const after = events[events.length - 1]!;
    expect(after.undo).toBeGreaterThanOrEqual(1);
  });
});

describe("History — clear", () => {
  it("drops both stacks", () => {
    const next = emptyDocument();
    next.body = [paragraph([text("one")])];
    editor.setDocument(next);
    editor.history.undo();
    expect(editor.history.canUndo()).toBe(false);
    expect(editor.history.canRedo()).toBe(true);
    editor.history.clear();
    expect(editor.history.canUndo()).toBe(false);
    expect(editor.history.canRedo()).toBe(false);
  });
});
