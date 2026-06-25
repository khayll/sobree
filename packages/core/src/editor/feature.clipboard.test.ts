import { beforeEach, describe, expect, it } from "vitest";
import { appendBlock, emptyDocument, paragraph, text } from "../doc/builders";
import type { Paragraph } from "../doc/types";
import { Editor } from "./index";
import { BLOCKS_MIME, parseBlocks, serializeBlocks } from "./ops/clipboard";

/**
 * Regression: copy a whole block and paste it below to get two similar
 * blocks. Drives the real wired path — a `copy` event serialises the
 * selected block, a `paste` event carrying that payload inserts a fresh
 * duplicate after the caret's block.
 */

/** Minimal clipboard backed by a Map — jsdom's DataTransfer is too partial
 *  to round-trip a custom MIME, so we attach our own to the events. */
function makeClipboard() {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
    items: [] as unknown[],
    _store: store,
  };
}

function fire(host: HTMLElement, type: "copy" | "cut" | "paste", clipboardData: object): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: clipboardData, configurable: true });
  host.dispatchEvent(ev);
  return ev;
}

/** Select a whole block's text content (offset 0 → end). */
function selectWholeBlock(host: HTMLElement, blockText: string): void {
  const blockEl = [...host.querySelectorAll<HTMLElement>("[data-block-id]")].find((e) =>
    (e.textContent ?? "").includes(blockText),
  );
  if (!blockEl) throw new Error(`block "${blockText}" not found`);
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode() as Text | null;
  let last = first;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) last = n as Text;
  if (!first || !last) throw new Error("no text nodes in block");
  const range = document.createRange();
  range.setStart(first, 0);
  range.setEnd(last, last.length);
  const sel = window.getSelection();
  if (!sel) throw new Error("no Selection in env");
  sel.removeAllRanges();
  sel.addRange(range);
}

describe("clipboard — serialize/parse", () => {
  it("round-trips blocks through the structured payload", () => {
    const blocks = [paragraph([text("Hi", { bold: true })], { alignment: "center" })];
    const parsed = parseBlocks(serializeBlocks(blocks));
    expect(parsed).toEqual(blocks);
  });

  it("rejects foreign / malformed clipboard data", () => {
    expect(parseBlocks("just text")).toBeNull();
    expect(parseBlocks('{"blocks":[]}')).toBeNull();
    expect(parseBlocks('{"blocks":[{"noKind":1}]}')).toBeNull();
    expect(parseBlocks(undefined)).toBeNull();
  });
});

describe("clipboard — copy a block, paste it below", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  function editorWith() {
    const doc = emptyDocument();
    doc.body = [];
    appendBlock(doc, paragraph([text("First line.")]));
    appendBlock(doc, paragraph([text("Duplicate me.", { bold: true })], { alignment: "center" }));
    appendBlock(doc, paragraph([text("Last line.")]));
    return new Editor(host, { initialDocument: doc });
  }

  it("inserts a similar block directly below the copied one", () => {
    const editor = editorWith();
    const before = editor.getDocument().body as Paragraph[];
    const original = before[1]!;

    const clip = makeClipboard();
    selectWholeBlock(host, "Duplicate me.");
    const copyEv = fire(host, "copy", clip);

    // The copy was intercepted and carries the structured payload.
    expect(copyEv.defaultPrevented).toBe(true);
    expect(clip._store.get(BLOCKS_MIME)).toBeTruthy();
    expect(clip.getData("text/plain")).toBe("Duplicate me.");

    // Paste (caret still in the copied block) → a duplicate lands at index 2.
    const pasteEv = fire(host, "paste", clip);
    expect(pasteEv.defaultPrevented).toBe(true);

    const after = editor.getDocument().body as Paragraph[];
    expect(after.length).toBe(before.length + 1);
    expect(after[2]).toEqual(original); // same kind, properties, runs
    expect(after[1]).toEqual(original); // the original is untouched
    expect(after[3]!.runs[0]).toMatchObject({ text: "Last line." });
    editor.destroy();
  });

  it("a partial in-block selection copies plain text, not a block", () => {
    const editor = editorWith();
    const blockEl = [...host.querySelectorAll<HTMLElement>("[data-block-id]")].find((e) =>
      (e.textContent ?? "").includes("Duplicate me."),
    )!;
    const tn = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(tn, 0);
    range.setEnd(tn, 4); // "Dupl" — partial
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const clip = makeClipboard();
    const copyEv = fire(host, "copy", clip);
    // Not intercepted — browser does its default plain-text copy.
    expect(copyEv.defaultPrevented).toBe(false);
    expect(clip._store.get(BLOCKS_MIME)).toBeUndefined();
    editor.destroy();
  });

  it("copies a multi-block range as whole blocks", () => {
    const editor = editorWith();
    const blocks = [...host.querySelectorAll<HTMLElement>("[data-block-id]")];
    const range = document.createRange();
    range.setStart(blocks[0]!, 0);
    range.setEnd(blocks[1]!, blocks[1]!.childNodes.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const clip = makeClipboard();
    fire(host, "copy", clip);
    const parsed = parseBlocks(clip._store.get(BLOCKS_MIME));
    expect(parsed).toHaveLength(2);
    expect((parsed![0] as Paragraph).runs[0]).toMatchObject({ text: "First line." });
    expect((parsed![1] as Paragraph).runs[0]).toMatchObject({ text: "Duplicate me." });
    editor.destroy();
  });

  it("cut removes the block and carries it on the clipboard", () => {
    const editor = editorWith();
    const clip = makeClipboard();
    selectWholeBlock(host, "Duplicate me.");
    const cutEv = fire(host, "cut", clip);

    expect(cutEv.defaultPrevented).toBe(true);
    expect(parseBlocks(clip._store.get(BLOCKS_MIME))).toHaveLength(1);
    const texts = (editor.getDocument().body as Paragraph[]).map((p) =>
      p.runs.map((r) => (r.kind === "text" ? r.text : "")).join(""),
    );
    expect(texts).toEqual(["First line.", "Last line."]); // the cut block is gone
    editor.destroy();
  });

  it("cut then paste moves the block", () => {
    const editor = editorWith();
    const clip = makeClipboard();
    selectWholeBlock(host, "Duplicate me.");
    fire(host, "cut", clip);
    // Caret lands on the block now at the cut site; paste re-inserts after it.
    fire(host, "paste", clip);

    const texts = (editor.getDocument().body as Paragraph[]).map((p) =>
      p.runs.map((r) => (r.kind === "text" ? r.text : "")).join(""),
    );
    expect(texts).toContain("Duplicate me.");
    expect(texts).toHaveLength(3); // back to three blocks, just reordered
    editor.destroy();
  });

  it("a partial in-block selection cuts via the browser default, not a block", () => {
    const editor = editorWith();
    const blockEl = [...host.querySelectorAll<HTMLElement>("[data-block-id]")].find((e) =>
      (e.textContent ?? "").includes("Duplicate me."),
    )!;
    const tn = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(tn, 0);
    range.setEnd(tn, 4);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const clip = makeClipboard();
    const cutEv = fire(host, "cut", clip);
    expect(cutEv.defaultPrevented).toBe(false);
    expect(clip._store.get(BLOCKS_MIME)).toBeUndefined();
    expect(editor.getDocument().body).toHaveLength(3); // no block removed
    editor.destroy();
  });
});
