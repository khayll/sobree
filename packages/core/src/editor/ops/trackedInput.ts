import type { Range as ApiRange, InlinePosition, Selection } from "../../doc/api";
import type { InlineRun, SobreeDocument } from "../../doc/types";
import type { EditorContext } from "../context";
import * as query from "../query";
import * as review from "./review";
import * as runs from "./runs";

/**
 * Track-changes *authoring* input — the DOM event handlers that route
 * tracked-mode keystrokes, IME composition, and paste through the typed
 * API so the resulting runs carry revision markers. Stateful (it holds
 * the IME composition snapshot + a warn-once set), so it's built once per
 * editor via {@link createTrackedInput} rather than exposed as free
 * functions like the other `ops/*` modules.
 *
 * Collaborators: `ops/runs` (insertRun / splitBlock / deleteRange /
 * insertImageFromFile), `ops/review` (markParagraphBreakForDelete for the
 * Backspace-at-start-of-paragraph merge), `query` (caret placement +
 * position refresh), and the kernel `restoreSnapshot` for the IME
 * rollback. The mode *config* (`getTrackChanges` / `setTrackChanges`)
 * stays on the Editor — it only touches the listener registry.
 */
export interface TrackedInput {
  /**
   * Route a tracked-mode `beforeinput` through the typed API. Returns
   * `true` if consumed (caller should `preventDefault`), `false` to let
   * the browser handle it natively (untracked).
   */
  handleBeforeInput(ie: InputEvent): boolean;
  /**
   * True when the caret sits in a block containing any revision wrapper
   * (`<ins>` / `<del>` / `.sobree-revision-format`). `beforeinput` uses
   * this in mode-OFF to take over the insert path so the browser doesn't
   * stamp the new character with the wrapper's marker.
   */
  caretInsideRevisionWrapper(): boolean;
  handleCompositionStart(e: CompositionEvent): void;
  handleCompositionEnd(e: CompositionEvent): void;
  onPaste(e: ClipboardEvent): Promise<void>;
  /**
   * Insert `text` at the current selection as a tracked paste — each
   * `\n` becomes a `splitBlock`, CRLF/CR normalised to LF. The plain-text
   * core of `onPaste`, exposed directly because jsdom provides no
   * `DataTransfer` to drive `onPaste` end-to-end in tests.
   */
  pasteTrackedText(text: string): void;
  /** Clear any in-flight composition state (called on editor destroy). */
  reset(): void;
}

export function createTrackedInput(ctx: EditorContext): TrackedInput {
  /**
   * Active IME composition state (`compositionstart` → `compositionend`).
   * `null` outside composition or in non-tracked mode. We let the browser
   * mutate the DOM natively during composition, then on end roll back to
   * `snapshot` and re-insert the composed string through `insertRun`.
   */
  let composition: { snapshot: SobreeDocument; caret: InlinePosition | null } | null = null;
  /** One-shot warning set for tracked-mode inputTypes we don't route yet. */
  const warned = new Set<string>();

  /**
   * Resolve the position to insert at when typing over the current
   * selection. For a caret, that's the caret; for a (same-block) range,
   * delete it first (tracked delete leaves runs in place marked `del`, so
   * the `from` offset stays valid). Returns `null` across blocks or on
   * failure.
   */
  function markedRangeForReplace(sel: Selection): InlinePosition | null {
    if (!sel) return null;
    if (sel.kind === "caret") {
      return query.refreshedPosition(ctx, sel.at);
    }
    if (sel.range.from.block.id !== sel.range.to.block.id) return null;
    const del = runs.deleteRange(ctx, sel.range);
    if (!del.ok) return null;
    return query.refreshedPosition(ctx, sel.range.from);
  }

  /** Range a Backspace-style key deletes (selection, else one char left). */
  function rangeForBackwardDelete(sel: Selection): ApiRange | null {
    if (!sel) return null;
    if (sel.kind === "range") return sel.range;
    if (sel.at.offset === 0) return null;
    const at = query.refreshedPosition(ctx, sel.at);
    if (!at) return null;
    return { from: { block: at.block, offset: at.offset - 1 }, to: at };
  }

  /** Forward-delete equivalent of `rangeForBackwardDelete`. */
  function rangeForForwardDelete(sel: Selection): ApiRange | null {
    if (!sel) return null;
    if (sel.kind === "range") return sel.range;
    const at = query.refreshedPosition(ctx, sel.at);
    if (!at) return null;
    const info = query.getBlockById(ctx, at.block.id);
    if (!info || at.offset >= info.length) return null;
    return { from: at, to: { block: at.block, offset: at.offset + 1 } };
  }

  function handleBeforeInput(ie: InputEvent): boolean {
    const sel = ctx.selection.get();
    if (!sel) return false;

    switch (ie.inputType) {
      case "insertText":
      case "insertReplacementText": {
        const text = ie.data ?? "";
        if (!text) return false;
        const insertAt = markedRangeForReplace(sel);
        if (!insertAt) return false;
        const run: InlineRun = { kind: "text", text, properties: {} };
        const result = runs.insertRun(ctx, insertAt, run);
        if (!result.ok) return true; // consumed but failed — don't fall through
        query.placeCaret(ctx, insertAt.block.id, insertAt.offset + text.length);
        return true;
      }
      case "deleteContentBackward":
      case "deleteWordBackward": {
        // Caret at offset 0 of a paragraph: "delete the paragraph break
        // before this paragraph" → mark its paragraph-mark del (merge on
        // accept). Own pending `ins` cancels instead. See
        // markParagraphBreakForDelete.
        if (ctx.trackChanges.enabled && sel.kind === "caret" && sel.at.offset === 0) {
          const idx = ctx.registry.indexOf(sel.at.block.id);
          if (idx > 0) {
            const result = review.markParagraphBreakForDelete(ctx, idx);
            if (!result.ok) return true;
            query.placeCaret(ctx, sel.at.block.id, 0);
            return true;
          }
          // At block 0 — no preceding break. Fall through (browser no-op).
        }

        const target = rangeForBackwardDelete(sel);
        if (!target) return false;
        const result = runs.deleteRange(ctx, target);
        if (!result.ok) return true;
        query.placeCaret(ctx, target.from.block.id, target.from.offset);
        return true;
      }
      case "deleteContentForward":
      case "deleteWordForward": {
        const target = rangeForForwardDelete(sel);
        if (!target) return false;
        const result = runs.deleteRange(ctx, target);
        if (!result.ok) return true;
        query.placeCaret(ctx, target.from.block.id, target.from.offset);
        return true;
      }
      case "deleteByCut": {
        if (sel.kind !== "range") return false;
        const result = runs.deleteRange(ctx, sel.range);
        if (!result.ok) return true;
        query.placeCaret(ctx, sel.range.from.block.id, sel.range.from.offset);
        return true;
      }
      case "insertParagraph": {
        // Enter — split the current paragraph at the caret (replacing any
        // selected range first, matching browser semantics).
        const at = markedRangeForReplace(sel);
        if (!at) return false;
        const result = runs.splitBlock(ctx, at);
        if (!result.ok) return true;
        query.placeCaret(ctx, result.value.id, 0);
        return true;
      }
      case "insertLineBreak": {
        // Shift+Enter — a soft `<br>` BreakRun carrying `revision: ins`.
        const at = markedRangeForReplace(sel);
        if (!at) return false;
        const breakRun: InlineRun = {
          kind: "break",
          type: "line",
          properties: {
            revision:
              ctx.trackChanges.author === undefined
                ? { type: "ins" }
                : { type: "ins", author: ctx.trackChanges.author },
          },
        };
        const result = runs.insertRun(ctx, at, breakRun);
        if (!result.ok) return true;
        query.placeCaret(ctx, at.block.id, at.offset + 1);
        return true;
      }
      default:
        if (!warned.has(ie.inputType)) {
          warned.add(ie.inputType);
          console.warn(
            `[editor] track-changes: inputType "${ie.inputType}" not yet routed through the API — falling through to the browser (this edit will be untracked). Phase B follow-up.`,
          );
        }
        return false;
    }
  }

  function handleCompositionStart(): void {
    if (!ctx.trackChanges.enabled) {
      composition = null;
      return;
    }
    // `ctx.doc` is immutable per-commit; capturing the reference is a
    // cheap O(1) snapshot. The browser's DOM mutations during composition
    // set domDirty via the input listener; we undo them at end.
    composition = {
      snapshot: ctx.doc,
      caret: ctx.selection.currentCaret(),
    };
  }

  function handleCompositionEnd(e: CompositionEvent): void {
    const state = composition;
    composition = null;
    if (!state || !state.caret) return;
    const text = e.data ?? "";

    // Roll back to the pre-composition AST + re-render. We can't trust the
    // DOM (the IME may have written intermediate text), so re-render from
    // the snapshot and then perform a clean tracked insert.
    ctx.restoreSnapshot(state.snapshot);

    if (text === "") {
      ctx.selection.set({ kind: "caret", at: state.caret });
      return;
    }

    const info = query.getBlockById(ctx, state.caret.block.id);
    if (!info) return;
    const at: InlinePosition = {
      block: { id: info.id, version: info.version },
      offset: state.caret.offset,
    };
    ctx.selection.set({ kind: "caret", at });
    const result = runs.insertRun(ctx, at, { kind: "text", text, properties: {} });
    if (result.ok) {
      query.placeCaret(ctx, info.id, at.offset + text.length);
    }
  }

  function caretInsideRevisionWrapper(): boolean {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    const { startContainer } = range;

    const el =
      startContainer.nodeType === Node.ELEMENT_NODE
        ? (startContainer as Element)
        : startContainer.parentElement;
    if (!el) return false;

    // Aggressive but reliable: any caret position in a block containing
    // *any* revision wrapper triggers the intercept — the browser's
    // contentEditable inheritance fires in too many caret configurations
    // to predict. Intercepting at block scope lands the next character as
    // a separate AST run; mergeAdjacentTextRuns keeps the AST clean.
    const block = el.closest<HTMLElement>("[data-block-id]");
    if (!block) return false;
    return !!block.querySelector(
      "ins.sobree-revision, del.sobree-revision, span.sobree-revision-format",
    );
  }

  /**
   * Insert `text` at the current selection in tracked mode, each `\n`
   * becoming a `splitBlock`. Used by `onPaste` for plain-text paste.
   */
  function pasteTrackedText(text: string): void {
    const sel = ctx.selection.get();
    const insertAt = markedRangeForReplace(sel);
    if (!insertAt) return;
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    let pos: InlinePosition | null = insertAt;
    let lastInsertedLength = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line !== "" && pos) {
        const r = runs.insertRun(ctx, pos, { kind: "text", text: line, properties: {} });
        if (!r.ok) return;
        lastInsertedLength = line.length;
      } else {
        lastInsertedLength = 0;
      }
      if (i < lines.length - 1 && pos) {
        const afterInsert = query.refreshedPosition(ctx, {
          block: pos.block,
          offset: pos.offset + lastInsertedLength,
        });
        if (!afterInsert) return;
        const split = runs.splitBlock(ctx, afterInsert);
        if (!split.ok) return;
        pos = { block: split.value, offset: 0 };
      } else {
        pos = pos
          ? query.refreshedPosition(ctx, {
              block: pos.block,
              offset: pos.offset + lastInsertedLength,
            })
          : null;
      }
    }
    if (pos) query.placeCaret(ctx, pos.block.id, pos.offset);
  }

  async function onPaste(e: ClipboardEvent): Promise<void> {
    const items = e.clipboardData?.items;
    if (!items) return;

    // Image-file paste — handled the same in tracked and untracked modes.
    for (const item of Array.from(items)) {
      if (item.kind !== "file") continue;
      if (!item.type.startsWith("image/")) continue;
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;
      await runs.insertImageFromFile(ctx, file);
      return;
    }

    // Tracked-mode text paste — route plain text through insertRun /
    // splitBlock so the runs carry markers. HTML/rich paste falls back to
    // plain text by design.
    if (ctx.trackChanges.enabled) {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text === "") return;
      e.preventDefault();
      pasteTrackedText(text);
    }
  }

  return {
    handleBeforeInput,
    caretInsideRevisionWrapper,
    handleCompositionStart,
    handleCompositionEnd,
    onPaste,
    pasteTrackedText,
    reset: () => {
      composition = null;
    },
  };
}
