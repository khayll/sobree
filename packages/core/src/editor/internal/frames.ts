/**
 * Editable-textbox-frame controller.
 *
 * Frames live in the floating overlay, OUTSIDE the body content hosts, so
 * they can't ride the body's block-registry `Selection` model or the body
 * read-back. This controller owns everything frame-specific that the
 * `Editor` would otherwise carry:
 *   - the dirty-frame set + the DOM read-back that re-serialises each
 *     edited frame into its `content.body`;
 *   - the pre-/post-edit selection capture + restore for gold-standard
 *     frame undo (undo → pre-edit caret, redo → post-edit caret, range
 *     reselect, focus-return);
 *   - the native `execCommand` mark path for a caret inside a frame.
 *
 * It operates over the {@link EditorContext} seam (host, selection,
 * registry, doc, scheduleChange) so the body reads identically to the
 * class methods it replaced.
 */

import type { CapturedSelection } from "../../history/types";
import type { EditorContext } from "../context";
import { serializeHostsToDocument } from "../view/docSerialize/index";
import { applyFrameSelection, frameSelectionOffsets } from "./frameCaret";
import { applySelectionToDom } from "./positionMap";

/**
 * Mark tag → `document.execCommand` name, for applying a toggle mark
 * inside an editable textbox frame (where the body-selection path can't
 * reach). The native commands produce `<b>`/`<i>`/`<u>`/… which the
 * frame read-back's inline serializer maps back to run properties.
 */
const MARK_EXEC_COMMAND: Record<string, string> = {
  strong: "bold",
  em: "italic",
  u: "underline",
  s: "strikeThrough",
  sup: "superscript",
  sub: "subscript",
};

export class FrameController {
  /**
   * Ids of editable textbox frames whose DOM the user has edited since
   * the last sync. Frames live in the floating overlay (outside the
   * body content hosts), so they need their own read-back path —
   * `syncFramesFromDom` re-serialises each dirty frame into
   * `anchoredFrames[id].content.body`.
   */
  private readonly dirtyFrameIds = new Set<string>();
  /**
   * Selection captured at `beforeinput` (pre-DOM-mutation) for the open
   * undo group — restored on undo so the caret lands where the edit began.
   * `hasPendingPreEdit` distinguishes "nothing stashed" from a stashed
   * `null` (a body `Selection` can legitimately be `null`).
   */
  private pendingPreEdit: CapturedSelection = null;
  private hasPendingPreEdit = false;

  constructor(private readonly ctx: EditorContext) {}

  /** True when a frame edit is pending a read-back. */
  hasDirtyFrames(): boolean {
    return this.dirtyFrameIds.size > 0;
  }

  /**
   * Route an `input` event: if the caret sits in an editable textbox
   * frame, mark that frame dirty and return `true` (the body must NOT be
   * read back). Returns `false` for an ordinary body edit.
   */
  routeInput(): boolean {
    const frameId = this.editedFrameId();
    if (frameId === null) return false;
    this.dirtyFrameIds.add(frameId);
    return true;
  }

  /**
   * Re-read the DOM of each dirty editable textbox frame into the AST.
   * The frame element IS the serialization host (the block renderer paints
   * its body directly into it), so `serializeHostsToDocument([el])` yields
   * the same `Block[]` shape as a body host. Matched to the AST frame by
   * its stable `data-anchor-id`. Pure body swap — geometry/anchor untouched.
   *
   * `captureRunDefaults` promotes each paragraph's rendered base font to
   * `runDefaults`, so a frame's text keeps its size/family even when a
   * keystroke (or a select-all-retype) strips every run's inline styling —
   * the heading no longer collapses to the default font on the next repaint.
   */
  syncFramesFromDom(): void {
    const frames = this.ctx.doc.anchoredFrames;
    if (!frames || frames.length === 0) {
      this.dirtyFrameIds.clear();
      return;
    }
    const elById = new Map<string, HTMLElement>();
    for (const el of this.ctx.host.querySelectorAll<HTMLElement>(
      ".paper-anchor[data-anchor-textbox]",
    )) {
      if (el.dataset.anchorId) elById.set(el.dataset.anchorId, el);
    }
    let changed = false;
    const next = frames.map((f) => {
      if (!this.dirtyFrameIds.has(f.id) || f.content.kind !== "textbox") return f;
      const el = elById.get(f.id);
      if (!el) return f;
      const body = serializeHostsToDocument([el], { captureRunDefaults: true }).body;
      changed = true;
      return { ...f, content: { ...f.content, body } };
    });
    this.dirtyFrameIds.clear();
    if (changed) this.ctx.setDoc({ ...this.ctx.doc, anchoredFrames: next });
  }

  /**
   * The id of the editable textbox frame the caret currently sits in, or
   * null when the selection is in ordinary body flow. Used to route an
   * `input` event to the frame read-back instead of the body read-back.
   */
  editedFrameId(): string | null {
    return this.focusedFrameEl()?.dataset.anchorId ?? null;
  }

  /** The editable textbox frame element the caret is inside, or null. */
  private focusedFrameEl(): HTMLElement | null {
    const sel = this.ctx.host.ownerDocument.getSelection();
    let node: Node | null = sel?.anchorNode ?? null;
    if (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
    const frame = (node as Element | null)?.closest?.(".paper-anchor[data-anchor-textbox]");
    return (frame as HTMLElement | null) ?? null;
  }

  /** The (freshly-painted) frame element with this `data-anchor-id`, or null. */
  private frameElById(id: string): HTMLElement | null {
    for (const el of this.ctx.host.querySelectorAll<HTMLElement>(
      ".paper-anchor[data-anchor-textbox]",
    )) {
      if (el.dataset.anchorId === id) return el;
    }
    return null;
  }

  /**
   * Capture the live selection for an undo step. A selection inside an
   * editable textbox frame becomes a `FrameSelection` — the body
   * `Selection` model is keyed on registry blocks and can't address frame
   * content — so undo can restore it the same way it restores a body
   * selection. Everything else is an ordinary body selection.
   */
  captureSelectionForHistory(): CapturedSelection {
    const frame = this.focusedFrameEl();
    if (frame?.dataset.anchorId) {
      const offsets = frameSelectionOffsets(frame, this.ctx.host.ownerDocument) ?? {
        start: 0,
        end: 0,
      };
      return { kind: "frame-selection", frameId: frame.dataset.anchorId, ...offsets };
    }
    return this.ctx.selection.get();
  }

  /**
   * The selection BEFORE the edit that opened the current undo group,
   * stashed by `onBeforeInput` (which fires before the DOM mutates). Falls
   * back to the live selection for edits that bypass `beforeinput`
   * (programmatic mutations, `setDocument`).
   */
  capturePreEditSelection(): CapturedSelection {
    return this.hasPendingPreEdit ? this.pendingPreEdit : this.captureSelectionForHistory();
  }

  /**
   * Stash the pre-edit selection on the first input of a new undo group,
   * so undo can land the caret where the edit began. `beforeinput` fires
   * before the browser mutates the DOM, so the live selection here is the
   * pre-edit position. Only the FIRST input of a group stashes; coalesced
   * inputs leave the group's `before` intact (`History.onGroupSettled`
   * clears the stash once a step has captured).
   *
   * Scoped to textbox frames. The body already restores its caret through
   * the proven `applySelectionToDom` path on `stack-item-popped`; we leave
   * its behaviour byte-for-byte unchanged (no pre-edit stash → `before`
   * falls back to the post-edit selection, same as `after`). Frames had no
   * working restore at all, so they get the full pre-/post-edit treatment.
   */
  onBeforeInput(): void {
    if (this.hasPendingPreEdit || this.focusedFrameEl() === null) return;
    this.pendingPreEdit = this.captureSelectionForHistory();
    this.hasPendingPreEdit = true;
  }

  /** Drop the pending pre-edit stash — a step has captured (or extended) it. */
  clearPendingPreEditSelection(): void {
    this.hasPendingPreEdit = false;
    this.pendingPreEdit = null;
  }

  /**
   * Restore an undo step's selection. Fires on `stack-item-popped`, which
   * runs AFTER the change handler has already repainted the frame overlay
   * (`adoptYDocState` calls `emitChangeNow` synchronously), so a captured
   * frame selection lands on the fresh frame element and sticks — the same
   * lifecycle the body selection restore relies on.
   */
  restoreCapturedSelection(sel: CapturedSelection): void {
    if (sel && sel.kind === "frame-selection") {
      const frame = this.frameElById(sel.frameId);
      if (!frame) return;
      frame.focus({ preventScroll: true });
      applyFrameSelection(frame, { start: sel.start, end: sel.end }, this.ctx.host.ownerDocument);
      return;
    }
    if (sel) applySelectionToDom(this.ctx._hosts(), sel);
  }

  /**
   * Toggle a mark on the caret inside an editable textbox frame, natively
   * (`document.execCommand`), so the body-selection mark path doesn't have
   * to understand frame coordinates. The resulting `<b>`/`<i>`/`<u>` tags
   * round-trip through the frame read-back (the inline serializer maps them
   * to run properties). Returns false when the caret isn't in a frame, so
   * the mark command falls back to the body path.
   */
  applyFrameMark(tag: string): boolean {
    const frameId = this.editedFrameId();
    if (frameId === null) return false;
    const cmd = MARK_EXEC_COMMAND[tag];
    if (!cmd) return false;
    this.ctx.host.ownerDocument.execCommand(cmd);
    // `execCommand` fires `input`, but mark it dirty explicitly so the
    // read-back runs even on engines that don't emit one for formatting.
    this.dirtyFrameIds.add(frameId);
    this.ctx.scheduleChange();
    return true;
  }

  /** Active state of `tag` at a frame caret (toolbar highlight), or null
   *  when the caret isn't in a frame. */
  frameMarkActive(tag: string): boolean | null {
    if (this.editedFrameId() === null) return null;
    const cmd = MARK_EXEC_COMMAND[tag];
    return cmd ? this.ctx.host.ownerDocument.queryCommandState(cmd) : false;
  }
}
