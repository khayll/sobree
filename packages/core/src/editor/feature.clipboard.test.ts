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
    expect(parseBlocks(serializeBlocks(blocks))).toEqual({ blocks, fragment: null });
    const ends = { first: true, last: false };
    expect(parseBlocks(serializeBlocks(blocks, { fragment: ends }))).toEqual({
      blocks,
      fragment: ends,
    });
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
    expect(parsed?.fragment).toBeNull();
    expect(parsed?.blocks).toHaveLength(2);
    expect((parsed!.blocks[0] as Paragraph).runs[0]).toMatchObject({ text: "First line." });
    expect((parsed!.blocks[1] as Paragraph).runs[0]).toMatchObject({ text: "Duplicate me." });
    editor.destroy();
  });

  it("copies a PARTIAL multi-block selection as sliced fragments, not whole blocks", () => {
    // Reported: select part of a paragraph (spanning into the next block),
    // copy, paste — the WHOLE paragraphs appeared. The copy handler treated
    // any multi-block range as whole-block coverage, ignoring the offsets.
    const editor = editorWith();
    const blocks = [...host.querySelectorAll<HTMLElement>("[data-block-id]")];
    const tn0 = document.createTreeWalker(blocks[0]!, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const tn1 = document.createTreeWalker(blocks[1]!, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(tn0, 6); // "First |line."
    range.setEnd(tn1, 9); // "Duplicate| me."
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const clip = makeClipboard();
    const copyEv = fire(host, "copy", clip);

    expect(copyEv.defaultPrevented).toBe(true);
    const parsed = parseBlocks(clip._store.get(BLOCKS_MIME));
    expect(parsed?.fragment).toEqual({ first: true, last: true });
    const texts = parsed!.blocks.map((b) =>
      (b as Paragraph).runs.map((r) => (r.kind === "text" ? r.text : "")).join(""),
    );
    expect(texts).toEqual(["line.", "Duplicate"]); // sliced, not whole
    // Formatting survives the slice.
    expect((parsed!.blocks[1] as Paragraph).runs[0]).toMatchObject({
      properties: { bold: true },
    });
    expect(clip.getData("text/plain")).toBe("line.\nDuplicate");
    editor.destroy();
  });

  it("pastes a fragment payload as EXACTLY the copied content (the reported bug)", () => {
    const editor = editorWith();
    const blocks = [...host.querySelectorAll<HTMLElement>("[data-block-id]")];
    const tn0 = document.createTreeWalker(blocks[0]!, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const tn1 = document.createTreeWalker(blocks[1]!, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(tn0, 6);
    range.setEnd(tn1, 9);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    const clip = makeClipboard();
    fire(host, "copy", clip);

    // Caret mid-way through "Last line." — then paste.
    const tn2 = document.createTreeWalker(blocks[2]!, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const caret = document.createRange();
    caret.setStart(tn2, 5); // "Last |line."
    caret.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caret);

    const pasteEv = fire(host, "paste", clip);
    expect(pasteEv.defaultPrevented).toBe(true);

    const texts = (editor.getDocument().body as Paragraph[]).map((p) =>
      p.runs.map((r) => (r.kind === "text" ? r.text : "")).join(""),
    );
    // The copied "line.<break>Duplicate" splices at the caret: the first
    // fragment joins the caret paragraph's head, the second joins its tail.
    // NOT two extra whole paragraphs.
    expect(texts).toEqual(["First line.", "Duplicate me.", "Last line.", "Duplicateline."]);
    editor.destroy();
  });

  it("a COMPLETE first block splits the target and stands alone (heading + fragment)", () => {
    // Reported follow-up: copy a fully-selected heading + partial next
    // paragraph, paste mid-paragraph — the heading must NOT merge inline into
    // the caret paragraph; it keeps its paragraph identity, splitting the
    // block to make place, and only the sliced fragment merges.
    const editor = editorWith();
    const blocks = [...host.querySelectorAll<HTMLElement>("[data-block-id]")];
    const tn0 = document.createTreeWalker(blocks[0]!, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const tn1 = document.createTreeWalker(blocks[1]!, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(tn0, 0); // block 0 fully covered
    range.setEnd(tn1, 9); // "Duplicate| me." — partial
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    const clip = makeClipboard();
    fire(host, "copy", clip);
    expect(parseBlocks(clip._store.get(BLOCKS_MIME))?.fragment).toEqual({
      first: false,
      last: true,
    });

    // Paste mid-way through "Last line.".
    const tn2 = document.createTreeWalker(blocks[2]!, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const caret = document.createRange();
    caret.setStart(tn2, 5); // "Last |line."
    caret.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caret);
    fire(host, "paste", clip);

    const texts = (editor.getDocument().body as Paragraph[]).map((p) =>
      p.runs.map((r) => (r.kind === "text" ? r.text : "")).join(""),
    );
    // "Last line." splits at the caret; the complete block stands alone
    // between the halves; the fragment merges into the tail half.
    expect(texts).toEqual([
      "First line.",
      "Duplicate me.",
      "Last ",
      "First line.",
      "Duplicateline.",
    ]);
    editor.destroy();
  });

  it("pasting over the STILL-ACTIVE selection reproduces exactly the copied content", () => {
    // Reported follow-up: copy heading + partial paragraph, paste without
    // moving the cursor — the fragment half vanished. Replace-with-self must
    // reproduce the copied content: the complete block stands alone (no empty
    // paragraph left above it) and the fragment merges with the remainder.
    const editor = editorWith();
    const blocks = [...host.querySelectorAll<HTMLElement>("[data-block-id]")];
    const tn0 = document.createTreeWalker(blocks[0]!, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const tn1 = document.createTreeWalker(blocks[1]!, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(tn0, 0); // block 0 fully covered
    range.setEnd(tn1, 9); // "Duplicate| me."
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    const clip = makeClipboard();
    fire(host, "copy", clip);

    // Paste immediately — selection still active.
    fire(host, "paste", clip);

    const texts = (editor.getDocument().body as Paragraph[]).map((p) =>
      p.runs.map((r) => (r.kind === "text" ? r.text : "")).join(""),
    );
    // Replace-with-self: the document reads exactly as before, with no empty
    // paragraph artifact and nothing lost.
    expect(texts).toEqual(["First line.", "Duplicate me.", "Last line."]);
    editor.destroy();
  });

  it("repeat paste alternates blocks — the caret lands AFTER the pasted fragment", () => {
    // Reported (Field Almanac screenshot): copy a complete kicker line + the
    // "Rea" start of the next heading, then paste repeatedly. The caret used
    // to land at the tail block's START — BEFORE the merged fragment — so
    // every repeat paste inserted ahead of the previous one: the standalone
    // blocks stacked up in a row ("Field Almanac" ×10) while the fragments
    // glued together behind the caret ("ReaReaRea…"). Word alternates:
    // fragment / block / fragment / block…
    const editor = editorWith();
    const blocks = [...host.querySelectorAll<HTMLElement>("[data-block-id]")];
    const tn0 = document.createTreeWalker(blocks[0]!, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const tn1 = document.createTreeWalker(blocks[1]!, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(tn0, 0); // "First line." fully covered (the kicker)
    range.setEnd(tn1, 3); // "Dup|licate me." — the fragment
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    const clip = makeClipboard();
    fire(host, "copy", clip);

    // Caret at the start of "Duplicate me." (like clicking before "Reading
    // the Sky"), then paste twice — the second paste uses the caret the
    // FIRST paste left behind.
    const caret = document.createRange();
    caret.setStart(tn1, 0);
    caret.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caret);
    fire(host, "paste", clip);
    fire(host, "paste", clip);

    const texts = (editor.getDocument().body as Paragraph[]).map((p) =>
      p.runs.map((r) => (r.kind === "text" ? r.text : "")).join(""),
    );
    // Alternation, not stacking: each paste lays down kicker + fragment IN
    // ORDER at the caret ("First line.¶Dup" twice at |Duplicate me. →
    // kicker, Dup / kicker / DupDuplicate me.). The broken caret gave
    // kicker, kicker stacked with "DupDup…" glued behind them.
    expect(texts).toEqual([
      "First line.",
      "First line.",
      "Dup",
      "First line.",
      "DupDuplicate me.",
      "Last line.",
    ]);
    editor.destroy();
  });

  it("cut of a partial multi-block selection removes ONLY the selection", () => {
    // Same root as the copy bug, but destructive: cut used to delete the
    // WHOLE endpoint blocks, taking text outside the selection with it.
    const editor = editorWith();
    const blocks = [...host.querySelectorAll<HTMLElement>("[data-block-id]")];
    const tn0 = document.createTreeWalker(blocks[0]!, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const tn1 = document.createTreeWalker(blocks[1]!, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(tn0, 6);
    range.setEnd(tn1, 9);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const clip = makeClipboard();
    const cutEv = fire(host, "cut", clip);

    expect(cutEv.defaultPrevented).toBe(true);
    expect(parseBlocks(clip._store.get(BLOCKS_MIME))?.fragment).toEqual({
      first: true,
      last: true,
    });
    const texts = (editor.getDocument().body as Paragraph[]).map((p) =>
      p.runs.map((r) => (r.kind === "text" ? r.text : "")).join(""),
    );
    // Unselected text survives; the endpoint paragraphs merge at the cut.
    expect(texts).toEqual(["First  me.", "Last line."]);
    editor.destroy();
  });

  it("cut removes the block and carries it on the clipboard", () => {
    const editor = editorWith();
    const clip = makeClipboard();
    selectWholeBlock(host, "Duplicate me.");
    const cutEv = fire(host, "cut", clip);

    expect(cutEv.defaultPrevented).toBe(true);
    expect(parseBlocks(clip._store.get(BLOCKS_MIME))?.blocks).toHaveLength(1);
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
