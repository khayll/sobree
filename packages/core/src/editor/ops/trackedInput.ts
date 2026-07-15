import type { Range as ApiRange, InlinePosition, Selection } from "../../doc/api";
import type { InlineRun, SobreeDocument } from "../../doc/types";
import type { EditorContext } from "../context";
import * as query from "../query";
import { pasteHtmlAtCaret } from "./pasteHtml";
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
   * A paragraph-BOUNDARY Backspace / Delete (a paragraph MERGE) routed
   * through the typed API even when tracked mode is OFF. Returns `true` if
   * it performed the merge (caller should `preventDefault`), `false` for
   * anything else — non-boundary deletes and non-paragraph neighbours keep
   * the light native + read-back path. The native contentEditable merge is
   * lossy (Chromium strips inline run formatting — small-caps / colour /
   * size — off the merged-in content), so the merge must run on the AST.
   */
  handleBoundaryMerge(ie: InputEvent): boolean;
  /**
   * Untracked `insertText` / `insertReplacementText` routed through the typed
   * API (model-first typing — Phase 3-2 of the model-first-editing plan).
   * Returns `true` if consumed (caller should `preventDefault`), `false` to
   * leave to the native path — composition (IME), empty data, or any other
   * inputType. Inserts a PLAIN run (`insertRun` reads `ctx.trackChanges`, which
   * is off here); tracked-mode insertText still goes through
   * {@link handleBeforeInput}.
   */
  handleUntrackedInsert(ie: InputEvent): boolean;
  /**
   * Untracked `deleteContentBackward` / `deleteContentForward` routed through
   * the typed API (model-first — Phase 3-3). `true` if consumed (caller
   * `preventDefault`s), `false` to leave to native (composition, word deletes,
   * or a document-edge no-op). A paragraph-boundary caret merges via
   * {@link handleBoundaryMerge}.
   */
  handleUntrackedDelete(ie: InputEvent): boolean;
  /**
   * Untracked `insertParagraph` (Enter) / `insertLineBreak` (Shift+Enter) routed
   * through the typed API (model-first — Phase 3-4). `true` if consumed, `false`
   * to leave to native (composition or any other inputType).
   */
  handleUntrackedNewline(ie: InputEvent): boolean;
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

  /**
   * Merge the two ADJACENT paragraphs at body indices `firstIdx` /
   * `secondIdx` through the AST (a cross-block `deleteRange` concatenates
   * their runs, formatting intact) and land the caret at the join. `true`
   * once consumed — even on failure, so the lossy native merge never runs.
   */
  function mergeParagraphs(firstIdx: number, secondIdx: number): boolean {
    const first = query.getBlock(ctx, firstIdx);
    const second = query.getBlock(ctx, secondIdx);
    if (first.kind !== "paragraph" || second.kind !== "paragraph") return false;
    const firstRef = ctx.registry.refAt(firstIdx);
    const secondRef = ctx.registry.refAt(secondIdx);
    const result = runs.deleteRange(ctx, {
      from: { block: firstRef, offset: first.length },
      to: { block: secondRef, offset: 0 },
    });
    if (result.ok) query.placeCaret(ctx, firstRef.id, first.length);
    return true;
  }

  function handleBoundaryMerge(ie: InputEvent): boolean {
    const sel = ctx.selection.get();
    if (!sel || sel.kind !== "caret") return false;
    const back = ie.inputType === "deleteContentBackward" || ie.inputType === "deleteWordBackward";
    const fwd = ie.inputType === "deleteContentForward" || ie.inputType === "deleteWordForward";
    if (!back && !fwd) return false;
    const info = query.getBlockById(ctx, sel.at.block.id);
    if (!info || info.kind !== "paragraph") return false;
    // Backspace merges with the previous block only at the paragraph START;
    // Delete merges with the next only at its END. Anywhere else this is an
    // ordinary character delete — leave it to the native path.
    if (back) {
      if (sel.at.offset !== 0 || info.index <= 0) return false;
      return mergeParagraphs(info.index - 1, info.index);
    }
    if (sel.at.offset < info.length || info.index >= ctx.doc.body.length - 1) return false;
    return mergeParagraphs(info.index, info.index + 1);
  }

  /**
   * Insert `text` at `sel` through the typed API. `insertRun` reads
   * `ctx.trackChanges`, so this stamps an `ins` run in tracked mode and a plain
   * run untracked — the one code path shared by tracked `insertText` and the
   * untracked model-first insert. Returns `true` once consumed (even on a
   * failed insert, so the caller never falls through to the lossy native path).
   */
  function insertTextRun(sel: Selection, text: string): boolean {
    const insertAt = markedRangeForReplace(sel);
    if (!insertAt) return false;
    const run: InlineRun = { kind: "text", text, properties: {} };
    const result = runs.insertRun(ctx, insertAt, run);
    if (!result.ok) return true; // consumed but failed — don't fall through
    query.placeCaret(ctx, insertAt.block.id, insertAt.offset + text.length);
    return true;
  }

  /**
   * Enter — split the current paragraph at the caret (replacing any selected
   * range first, matching browser semantics). `splitBlock` reads
   * `ctx.trackChanges`, so the new paragraph mark is `ins`-stamped in tracked
   * mode and plain untracked. Shared by the tracked and untracked paths.
   */
  function splitParagraphAt(sel: Selection): boolean {
    const at = markedRangeForReplace(sel);
    if (!at) return false;
    const result = runs.splitBlock(ctx, at);
    if (!result.ok) return true;
    query.placeCaret(ctx, result.value.id, 0);
    return true;
  }

  /**
   * Shift+Enter — a soft `<br>` BreakRun. Carries `revision: ins` in tracked
   * mode, plain untracked. Shared by the tracked and untracked paths.
   */
  function insertLineBreakAt(sel: Selection): boolean {
    const at = markedRangeForReplace(sel);
    if (!at) return false;
    const breakRun: InlineRun = {
      kind: "break",
      type: "line",
      properties: ctx.trackChanges.enabled
        ? {
            revision:
              ctx.trackChanges.author === undefined
                ? { type: "ins" }
                : { type: "ins", author: ctx.trackChanges.author },
          }
        : {},
    };
    const result = runs.insertRun(ctx, at, breakRun);
    if (!result.ok) return true;
    query.placeCaret(ctx, at.block.id, at.offset + 1);
    return true;
  }

  function handleUntrackedInsert(ie: InputEvent): boolean {
    // Composition (IME) stays native-then-reconcile — never intercept it,
    // even if it surfaces as insertText.
    if (ie.isComposing) return false;
    if (ie.inputType !== "insertText" && ie.inputType !== "insertReplacementText") return false;
    const text = ie.data ?? "";
    if (!text) return false;
    const sel = ctx.selection.get();
    if (!sel) return false;
    return insertTextRun(sel, text);
  }

  /**
   * Untracked `deleteContentBackward` / `deleteContentForward` routed through the
   * typed API (model-first — Phase 3-3). Covers the single-char delete and a
   * range delete (Backspace/Delete over a selection); a caret at a paragraph
   * boundary delegates to {@link handleBoundaryMerge} (the MERGE, already on the
   * API). WORD deletes (`deleteWord*`) stay native — the API's one-char range
   * would silently downgrade a word delete to a char delete. Returns `false`
   * (native) for composition or any other inputType.
   */
  function handleUntrackedDelete(ie: InputEvent): boolean {
    if (ie.isComposing) return false;
    const back = ie.inputType === "deleteContentBackward";
    const fwd = ie.inputType === "deleteContentForward";
    if (!back && !fwd) return false;
    const sel = ctx.selection.get();
    if (!sel) return false;
    const target = back ? rangeForBackwardDelete(sel) : rangeForForwardDelete(sel);
    // A null range means the caret sits at a paragraph boundary (start for
    // Backspace, end for Delete) — that's a MERGE, or a no-op at the document
    // edge; `handleBoundaryMerge` owns both (and returns false ⇒ native at the
    // edge).
    if (!target) return handleBoundaryMerge(ie);
    const result = runs.deleteRange(ctx, target);
    if (!result.ok) return true; // consumed but failed — don't fall through
    query.placeCaret(ctx, target.from.block.id, target.from.offset);
    return true;
  }

  /**
   * Untracked `insertParagraph` (Enter) / `insertLineBreak` (Shift+Enter)
   * routed through the typed API (model-first — Phase 3-4). Enter is a
   * STRUCTURAL edit (block count changes), so the in-place render patch falls
   * back to a full render for it — correct, and the paginator reflows. Returns
   * `false` (native) for composition or any other inputType.
   */
  function handleUntrackedNewline(ie: InputEvent): boolean {
    if (ie.isComposing) return false;
    const sel = ctx.selection.get();
    if (!sel) return false;
    if (ie.inputType === "insertParagraph") return splitParagraphAt(sel);
    if (ie.inputType === "insertLineBreak") return insertLineBreakAt(sel);
    return false;
  }

  function handleBeforeInput(ie: InputEvent): boolean {
    const sel = ctx.selection.get();
    if (!sel) return false;

    switch (ie.inputType) {
      case "insertText":
      case "insertReplacementText": {
        const text = ie.data ?? "";
        if (!text) return false;
        return insertTextRun(sel, text);
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
      case "insertParagraph":
        return splitParagraphAt(sel);
      case "insertLineBreak":
        return insertLineBreakAt(sel);
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
   * Insert plain `text` at the current selection, each `\n` becoming a
   * `splitBlock`. The plain-text fallback for `onPaste` (used tracked AND
   * untracked — `insertRun` stamps `ins` only when tracked); rich `text/html`
   * paste goes through `pasteHtmlAtCaret` first.
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

    // Model-first paste (tracked AND untracked — Phase 3-5). Rich `text/html`
    // is parsed to AST and inserted with formatting; plain text is the
    // fallback. `insertRun` / `pasteHtmlAtCaret` read `ctx.trackChanges`, so
    // tracked paste stamps `ins`.
    const html = e.clipboardData?.getData("text/html") ?? "";
    if (html !== "") {
      e.preventDefault();
      if (pasteHtmlAtCaret(ctx, html)) return;
    }
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (text === "") return;
    e.preventDefault();
    pasteTrackedText(text);
  }

  return {
    handleBeforeInput,
    handleBoundaryMerge,
    handleUntrackedInsert,
    handleUntrackedDelete,
    handleUntrackedNewline,
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
