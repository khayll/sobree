/**
 * Accept / reject controls for tracked-change marks.
 *
 * A shared floating popover (one per controller) appears above a
 * revision mark on hover, offering ✓ accept and ✗ reject. The popover
 * is appended to `document.body` and `position: fixed` — so it stays
 * UI-sized regardless of the document zoom, and isn't clipped by the
 * viewport.
 *
 * The accept/reject *range* comes from `editor.getRevisions()` — core
 * coalesces contiguous same-author runs into logical `RevisionSpan`s
 * and hands back exact, versioned ranges. The plugin only has to
 * figure out *which* span the hovered mark belongs to (one offset
 * lookup), never to construct the range itself.
 *
 * Spans are fetched *live* on every hover rather than cached: the walk
 * is O(runs) and only runs on pointer-over, and a fresh fetch carries
 * the current block versions — so the range never fails optimistic
 * locking against a doc that moved since the last paginate.
 */

import type { EditResult, Editor, RenderedRevisionMark, RevisionSpan } from "@sobree/core";
import { ICON_ACCEPT, ICON_REJECT } from "./icons";

/** How long to keep the popover alive after the pointer leaves the
 *  mark, so the user can travel into the popover itself. */
const HIDE_DELAY_MS = 220;

export class RevisionActions {
  private readonly editor: Editor;
  private readonly stackRoot: HTMLElement;
  private readonly popover: HTMLElement;
  private readonly onOver: (e: Event) => void;
  private readonly onOut: (e: Event) => void;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  /** The revision span the popover currently targets. */
  private target: RevisionSpan | null = null;

  constructor(editor: Editor, stackRoot: HTMLElement) {
    this.editor = editor;
    this.stackRoot = stackRoot;
    this.popover = this.buildPopover();
    document.body.appendChild(this.popover);

    this.onOver = (e) => this.handleOver(e);
    this.onOut = (e) => this.handleOut(e);
    this.stackRoot.addEventListener("mouseover", this.onOver);
    this.stackRoot.addEventListener("mouseout", this.onOut);
  }

  destroy(): void {
    this.stackRoot.removeEventListener("mouseover", this.onOver);
    this.stackRoot.removeEventListener("mouseout", this.onOut);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.popover.remove();
  }

  // ---- popover element ----

  private buildPopover(): HTMLElement {
    const pop = document.createElement("div");
    pop.className = "sobree-review-actions";
    pop.setAttribute("role", "toolbar");
    pop.append(
      this.actionButton("Accept change", ICON_ACCEPT, "accept"),
      this.actionButton("Reject change", ICON_REJECT, "reject"),
    );
    pop.addEventListener("mouseenter", () => this.cancelHide());
    pop.addEventListener("mouseleave", () => this.scheduleHide());
    return pop;
  }

  private actionButton(label: string, svg: string, kind: "accept" | "reject"): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `sobree-review-actions__btn is-${kind}`;
    btn.title = label; // native hover tooltip ("alt text")
    btn.setAttribute("aria-label", label);
    btn.innerHTML = svg;
    btn.addEventListener("click", () => this.run(kind));
    return btn;
  }

  // ---- hover handling ----

  private handleOver(e: Event): void {
    // `nearestRevisionMark` resolves the most-specific mark at the
    // pointer (inline > format > paragraph) — the same specificity the
    // renderer's wrapper nesting implies, so an inserted + format-changed
    // run resolves to the inline `ins`/`del` (accepting it covers both).
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const mark = this.editor.renderedDocument.nearestRevisionMark(target);
    if (!mark) return;
    const span = this.resolveSpan(mark);
    if (span) this.openOn(mark.element, span);
  }

  private handleOut(e: Event): void {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (this.editor.renderedDocument.nearestRevisionMark(target)) {
      this.scheduleHide();
    }
  }

  /** Dispatch a rendered mark to the span resolver for its level. */
  private resolveSpan(mark: RenderedRevisionMark): RevisionSpan | null {
    switch (mark.kind) {
      case "inline-insert":
      case "inline-delete":
        return this.resolveInlineSpan(mark);
      case "format":
        return this.resolveFormatSpan(mark);
      case "paragraph":
        return this.resolveParagraphSpan(mark);
    }
  }

  private openOn(mark: HTMLElement, span: RevisionSpan): void {
    this.cancelHide();
    this.target = span;
    this.label(span);
    this.position(mark);
  }

  private scheduleHide(): void {
    this.cancelHide();
    this.hideTimer = setTimeout(() => this.hide(), HIDE_DELAY_MS);
  }

  private cancelHide(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  /** Tooltip wording follows the span's level + revision kind(s). */
  private label(span: RevisionSpan): void {
    let noun: string;
    if (span.level === "format") {
      noun = "format change";
    } else if (span.level === "paragraph") {
      noun = span.kinds[0] === "del" ? "paragraph deletion" : "paragraph insertion";
    } else {
      noun =
        span.kinds.length > 1 ? "replacement" : span.kinds[0] === "del" ? "deletion" : "insertion";
    }
    const [accept, reject] = Array.from(
      this.popover.querySelectorAll<HTMLElement>(".sobree-review-actions__btn"),
    );
    if (accept) {
      accept.title = `Accept ${noun}`;
      accept.setAttribute("aria-label", accept.title);
    }
    if (reject) {
      reject.title = `Reject ${noun}`;
      reject.setAttribute("aria-label", reject.title);
    }
  }

  private position(mark: HTMLElement): void {
    const r = mark.getBoundingClientRect();
    this.popover.classList.add("is-visible");
    const popW = this.popover.offsetWidth || 64;
    let left = r.left + r.width / 2 - popW / 2;
    left = Math.max(4, Math.min(left, window.innerWidth - popW - 4));
    const top = Math.max(4, r.top - this.popover.offsetHeight - 6);
    this.popover.style.left = `${left}px`;
    this.popover.style.top = `${top}px`;
  }

  private hide(): void {
    this.popover.classList.remove("is-visible");
    this.target = null;
  }

  // ---- accept / reject ----

  /**
   * Dispatch the accept/reject to the right editor method based on the
   * span's `level`. Inline → `acceptRevision` / `rejectRevision`,
   * paragraph → the paragraph variant (takes a `BlockRef`, not a
   * range), format → the format variant (range over the format-changed
   * runs). The popover doesn't track which one fired; the level on the
   * cached `target` span is the source of truth.
   */
  private run(kind: "accept" | "reject"): void {
    const span = this.target;
    if (!span) return;
    let result: EditResult<void>;
    if (span.level === "paragraph") {
      const blockRef = span.range.from.block;
      result =
        kind === "accept"
          ? this.editor.acceptParagraphRevision(blockRef)
          : this.editor.rejectParagraphRevision(blockRef);
    } else if (span.level === "format") {
      result =
        kind === "accept"
          ? this.editor.acceptFormatRevision(span.range)
          : this.editor.rejectFormatRevision(span.range);
    } else {
      result =
        kind === "accept"
          ? this.editor.acceptRevision(span.range)
          : this.editor.rejectRevision(span.range);
    }
    if (!result.ok) {
      console.warn(`[review] ${kind} revision failed:`, result.error);
    }
    this.hide();
  }

  /**
   * Map a hovered inline `ins`/`del` mark to its `RevisionSpan`. We
   * compute the mark's character offset within its block, then pick the
   * inline-level span whose range covers it.
   */
  private resolveInlineSpan(mark: RenderedRevisionMark): RevisionSpan | null {
    const located = this.locate(mark);
    if (!located) return null;
    const { blockId, offset } = located;
    for (const span of this.editor.getRevisions()) {
      if (span.level !== "inline" && span.level !== undefined) continue;
      if (
        span.range.from.block.id === blockId &&
        span.range.from.offset <= offset &&
        offset < span.range.to.offset
      ) {
        return span;
      }
    }
    return null;
  }

  /**
   * Map a hovered format-changed run wrapper to its `RevisionSpan`.
   * Same offset-lookup as inline, but we accept the `format` level.
   */
  private resolveFormatSpan(mark: RenderedRevisionMark): RevisionSpan | null {
    const located = this.locate(mark);
    if (!located) return null;
    const { blockId, offset } = located;
    for (const span of this.editor.getRevisions()) {
      if (span.level !== "format") continue;
      if (
        span.range.from.block.id === blockId &&
        span.range.from.offset <= offset &&
        offset < span.range.to.offset
      ) {
        return span;
      }
    }
    return null;
  }

  /**
   * Map a paragraph-mark revision to its paragraph-level `RevisionSpan`.
   * The whole block is the target; no offset math needed — just match by
   * block id.
   */
  private resolveParagraphSpan(mark: RenderedRevisionMark): RevisionSpan | null {
    const blockId = mark.blockRef?.id;
    if (!blockId) return null;
    for (const span of this.editor.getRevisions()) {
      if (span.level !== "paragraph") continue;
      if (span.range.from.block.id === blockId) return span;
    }
    return null;
  }

  /**
   * Resolve the block id + the mark's character offset within that block
   * — the two coordinates the offset-lookup resolvers need. Returns
   * `null` if the mark isn't inside a live, rendered block.
   */
  private locate(mark: RenderedRevisionMark): { blockId: string; offset: number } | null {
    const blockId = mark.blockRef?.id;
    if (!blockId) return null;
    const block = this.editor.renderedDocument.elementForBlockId(blockId);
    if (!block) return null;
    return { blockId, offset: textLengthBefore(block, mark.element) };
  }
}

/** Character count of `block`'s text content before `el` starts. */
function textLengthBefore(block: HTMLElement, el: HTMLElement): number {
  const range = document.createRange();
  range.selectNodeContents(block);
  range.setEndBefore(el);
  return range.toString().length;
}
