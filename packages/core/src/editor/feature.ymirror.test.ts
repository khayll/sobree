import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { appendBlock, emptyDocument, heading, paragraph, text } from "../doc/builders";
import type { Block } from "../doc/types";
import { projectYDoc } from "../ydoc";
import { Editor } from "./index";

describe("Editor — Y.Doc mirror (Phase 1a)", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("seeds the Y.Doc from initialDocument on construction", () => {
    const initial = emptyDocument();
    appendBlock(initial, heading(1, [text("Title")]));
    appendBlock(initial, paragraph([text("Hello.")]));

    const editor = new Editor(host, { initialDocument: initial });

    const { doc, ids } = projectYDoc(editor.ydoc);
    expect(doc.body.length).toBe(initial.body.length);
    expect(ids.length).toBe(initial.body.length);
    // Block content survives the round trip.
    expect(doc.body[doc.body.length - 1]).toEqual(initial.body[initial.body.length - 1]);
  });

  it("accepts a user-provided Y.Doc", () => {
    const ydoc = new Y.Doc();
    const editor = new Editor(host, { ydoc });
    expect(editor.ydoc).toBe(ydoc);
    // Default empty doc is seeded.
    const projected = projectYDoc(ydoc);
    expect(projected.doc.body.length).toBe(1);
  });

  it("mirrors setDocument into the Y.Doc", () => {
    const editor = new Editor(host);
    const next = emptyDocument();
    appendBlock(next, paragraph([text("Replaced.")]));
    editor.setDocument(next);

    const { doc } = projectYDoc(editor.ydoc);
    expect(doc.body.length).toBe(next.body.length);
    expect(doc.body[doc.body.length - 1]).toEqual(next.body[next.body.length - 1]);
  });

  it("mirrors block-level inserts into the Y.Doc", () => {
    const initial = emptyDocument();
    appendBlock(initial, heading(1, [text("Title")]));
    const editor = new Editor(host, { initialDocument: initial });

    const ref = editor.getBlock(1).id;
    const result = editor.insertBlockAfter({ id: ref, version: 0 }, paragraph([text("Inserted.")]));
    expect(result.ok).toBe(true);

    const { doc, ids } = projectYDoc(editor.ydoc);
    expect(doc.body.length).toBe(3);
    expect(ids.length).toBe(3);
    // The inserted block is at index 2.
    expect(doc.body[2]).toMatchObject({ kind: "paragraph" });
  });

  it("mirrors block-level deletes into the Y.Doc", () => {
    const initial = emptyDocument();
    appendBlock(initial, heading(1, [text("Title")]));
    appendBlock(initial, paragraph([text("Body")]));
    const editor = new Editor(host, { initialDocument: initial });
    expect(editor.getDocument().body.length).toBe(3);

    const blockId = editor.getBlock(2).id;
    const result = editor.deleteBlock({ id: blockId, version: 0 });
    expect(result.ok).toBe(true);

    const { doc } = projectYDoc(editor.ydoc);
    expect(doc.body.length).toBe(editor.getDocument().body.length);
    expect(doc.body.length).toBe(2);
  });

  it("preserves the caret when a remote Y.Doc update rebuilds the DOM", () => {
    const initial = emptyDocument();
    appendBlock(initial, heading(1, [text("Title")]));
    appendBlock(initial, paragraph([text("Second block body here")]));
    const editor = new Editor(host, { initialDocument: initial });

    // Put the caret inside the SECOND content block's text.
    const blockEl = [...host.querySelectorAll<HTMLElement>("[data-block-id]")].find((e) =>
      /Second block body/.test(e.textContent ?? ""),
    );
    const textNode = findFirstText(blockEl!);
    const targetId = blockEl!.getAttribute("data-block-id");
    const range = document.createRange();
    range.setStart(textNode, 7);
    range.collapse(true);
    const sel = window.getSelection();
    if (!sel) throw new Error("no Selection in test env");
    sel.removeAllRanges();
    sel.addRange(range);

    // A provider applies an update with a non-local origin (collab peer, or
    // y-indexeddb's async load) → `adoptYDocState` rebuilds the whole DOM.
    editor.ydoc.transact(() => {
      editor.ydoc.getMap("__probe").set("x", 1);
    }, "remote-peer");

    // Caret must be restored INTO the rebuilt DOM at the same spot — not
    // left on a detached node or collapsed to the document start.
    const after = window.getSelection();
    expect(after?.anchorNode?.isConnected).toBe(true);
    const anchorEl =
      after?.anchorNode?.nodeType === 3
        ? after.anchorNode.parentElement
        : (after?.anchorNode as Element | null);
    expect(anchorEl?.closest("[data-block-id]")?.getAttribute("data-block-id")).toBe(targetId);
    expect(after?.anchorOffset).toBe(7);
  });

  it("the same Y.Doc can be observed by external code", () => {
    const editor = new Editor(host);
    const updates: number[] = [];
    editor.ydoc.on("afterTransaction", () => {
      updates.push(editor.ydoc.getArray("body").length);
    });
    appendOne(editor, paragraph([text("first")]));
    appendOne(editor, paragraph([text("second")]));
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.at(-1)).toBe(editor.getDocument().body.length);
  });
});

function appendOne(editor: Editor, block: Block): void {
  const last = editor.getBlock(editor.getDocument().body.length - 1);
  editor.insertBlockAfter({ id: last.id, version: last.version }, block);
}

/** First text node under `el` (the caret target for the selection test). */
function findFirstText(el: HTMLElement): Text {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  if (!node) throw new Error("no text node in block");
  return node as Text;
}
