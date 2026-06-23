/**
 * Top-level review dock — the "there are unresolved tracked changes
 * in this doc" UI. A small horizontal pill anchored to one corner of
 * the rendering area via core's shared floating-corner stack.
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │ ⚑ 5 changes · 2 authors │ ◀ ▶ │ ✓ All │ ✗ All │
 *   └────────────────────────────────────────────────────────┘
 *
 * Visibility:
 *   - Hidden when `editor.getRevisions().length === 0` (clean doc).
 *   - Shown otherwise; auto-updates on every editor `change` /
 *     `paginate` via the controller's existing refresh path.
 *
 * Navigation:
 *   - Maintains a `cursorIndex` over `getRevisions()` results.
 *   - ◀ / ▶ moves the cursor, scrolls the corresponding DOM mark
 *     into view (smooth), and triggers a CSS pulse on the mark via
 *     the `.is-flashing` class for `FLASH_MS`.
 *   - The cursor is clamped on every refresh, so accepting the
 *     current revision advances naturally.
 *
 * The dock is intentionally separate from the toolbar pill in
 * `@sobree/block-tools`. The pill is about the *mode flag* (toggles
 * authoring behaviour, lives in a per-block toolbar). The dock is
 * about *unresolved revisions* (auto-shows when they exist, lives
 * floating regardless of selection). A reviewer opening a `.docx`
 * full of someone else's tracked changes shouldn't have to discover
 * a per-block toolbar to act on them.
 */

import { type Editor, type FloatingCornerPlacement, getFloatingCorner } from "@sobree/core";
import { colorForAuthor } from "./authorColor";

/** How long the flash pulse runs on a navigated-to mark, in ms. */
const FLASH_MS = 700;

export interface ReviewDockOptions {
  /** Element to anchor against. Typically `ctx.host` (rendering area). */
  host: HTMLElement;
  /** Editor for `getRevisions` + `accept/rejectAllRevisions` + DOM lookup
   *  (revision marks to scroll/flash, via `editor.renderedDocument`). */
  editor: Editor;
  /** Which corner to dock in. Defaults to `top-right`. */
  placement?: FloatingCornerPlacement;
}

export class ReviewDock {
  private readonly host: HTMLElement;
  private readonly editor: Editor;
  private readonly placement: FloatingCornerPlacement;
  private readonly root: HTMLElement;
  private cursorIndex = 0;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private flashTarget: HTMLElement | null = null;

  constructor(opts: ReviewDockOptions) {
    this.host = opts.host;
    this.editor = opts.editor;
    this.placement = opts.placement ?? "top-right";

    this.root = document.createElement("div");
    this.root.className = "sobree-review-dock";
    this.root.dataset.placement = this.placement;
    this.root.setAttribute("role", "toolbar");
    this.root.setAttribute("aria-label", "Review tracked changes");
    this.root.hidden = true;
    this.root.innerHTML = this.buildHtml();

    getFloatingCorner(this.host, this.placement).appendChild(this.root);

    this.root.addEventListener("click", (e) => this.handleClick(e));
  }

  destroy(): void {
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.clearFlash();
    this.root.remove();
  }

  /**
   * Re-render with the current revision count + author summary. Called
   * by the controller from its rAF/timer-debounced refresh, so every
   * `change` and `paginate` event keeps the dock in sync without us
   * registering our own listeners.
   */
  refresh(): void {
    const spans = this.editor.getRevisions();
    const summary = this.root.querySelector<HTMLElement>(".sobree-review-dock__summary");

    if (spans.length === 0) {
      // Empty state — dock stays visible with an explicit "nothing to
      // do here" message, no action buttons. Gives the user a clear
      // signal that accept-all/reject-all are intentionally not
      // available because there's nothing to act on, rather than a
      // disappeared dock + ambiguous state. The `.is-empty` class
      // hides the divider + buttons + nav arrows via CSS.
      this.root.hidden = false;
      this.root.classList.add("is-empty");
      this.cursorIndex = 0;
      if (summary) {
        summary.textContent = "No changes to be tracked";
        // Reset the accent so the empty-state pill isn't tinted by a
        // stale author colour from before the last accept-all.
        summary.style.removeProperty("--sobree-review-dock-accent");
      }
      return;
    }

    this.root.hidden = false;
    this.root.classList.remove("is-empty");
    // Clamp cursor to current count (a previous index may now be out
    // of range because the user accepted/rejected something).
    if (this.cursorIndex >= spans.length) this.cursorIndex = spans.length - 1;
    if (this.cursorIndex < 0) this.cursorIndex = 0;

    const authors = new Set(spans.map((s) => s.author ?? ""));
    const count = spans.length;
    if (summary) {
      const noun = count === 1 ? "change" : "changes";
      const authorPart = authors.size > 1 ? ` · ${authors.size} authors` : "";
      summary.textContent = `${count} ${noun}${authorPart}`;
    }
    // Reflect the current author of the cursor span in the summary's
    // accent — same colour the marks use.
    const current = spans[this.cursorIndex];
    if (current && summary) {
      summary.style.setProperty("--sobree-review-dock-accent", colorForAuthor(current.author));
    }
  }

  // ---- handlers ----

  private handleClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!btn) return;
    e.preventDefault();
    const action = btn.dataset.action;
    switch (action) {
      case "prev":
        this.navigate(-1);
        break;
      case "next":
        this.navigate(1);
        break;
      case "accept-all": {
        const r = this.editor.acceptAllRevisions();
        if (!r.ok) console.warn("[review] acceptAllRevisions failed:", r.error);
        break;
      }
      case "reject-all": {
        const r = this.editor.rejectAllRevisions();
        if (!r.ok) console.warn("[review] rejectAllRevisions failed:", r.error);
        break;
      }
    }
  }

  private navigate(delta: 1 | -1): void {
    const spans = this.editor.getRevisions();
    if (spans.length === 0) return;
    // Wrap around — common UX expectation for "next" past the last
    // item and "prev" before the first.
    this.cursorIndex = (this.cursorIndex + delta + spans.length) % spans.length;
    const span = spans[this.cursorIndex];
    if (!span) return;
    const mark = this.findMarkForSpan(span);
    if (mark) this.scrollIntoViewAndFlash(mark);
    this.refresh();
  }

  /**
   * Find a DOM element matching the given revision span. We need this
   * to scroll to. The element type depends on the span's level:
   *   - inline   → an `<ins>` / `<del>` element inside the right block
   *                whose character range covers the span.
   *   - paragraph → the `<p data-block-revision>` element for the block.
   *   - format   → a `span.sobree-revision-format` inside the right block.
   *
   * Returns `null` if the mark isn't currently rendered (e.g. the
   * span is on a not-yet-paginated block, or the doc just changed).
   */
  private findMarkForSpan(span: ReturnType<Editor["getRevisions"]>[number]): HTMLElement | null {
    const block = this.editor.renderedDocument.elementForBlockId(span.range.from.block.id);
    if (!block) return null;
    if (span.level === "paragraph") return block;
    const wantFormat = span.level === "format";
    // First matching mark within the block — good enough; refinement by
    // exact character range would need text-node walking which the
    // popover doesn't bother with either.
    for (const mark of this.editor.renderedDocument.revisionMarks(block)) {
      const isInline = mark.kind === "inline-insert" || mark.kind === "inline-delete";
      if (wantFormat ? mark.kind === "format" : isInline) return mark.element;
    }
    return null;
  }

  private scrollIntoViewAndFlash(mark: HTMLElement): void {
    // Centred so the user can scan context around the revision.
    // `behavior: "smooth"` is honoured by all modern browsers and
    // respects CSS transforms (our viewport zoom is one).
    mark.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    this.flash(mark);
  }

  private flash(mark: HTMLElement): void {
    // Clear any in-flight flash so a rapid prev/next sequence pulses
    // the most recent target only, not a stale one.
    this.clearFlash();
    mark.classList.add("is-flashing");
    this.flashTarget = mark;
    this.flashTimer = setTimeout(() => this.clearFlash(), FLASH_MS);
  }

  private clearFlash(): void {
    if (this.flashTimer) {
      clearTimeout(this.flashTimer);
      this.flashTimer = null;
    }
    if (this.flashTarget) {
      this.flashTarget.classList.remove("is-flashing");
      this.flashTarget = null;
    }
  }

  // ---- markup ----

  private buildHtml(): string {
    // Keep the markup minimal; CSS owns the visuals. Buttons use SVG
    // icons inline so the plugin has no external icon dependency.
    return `
      <span class="sobree-review-dock__summary" aria-live="polite"></span>
      <span class="sobree-review-dock__divider"></span>
      <button type="button" class="sobree-review-dock__btn" data-action="prev"
              title="Previous change" aria-label="Previous change">
        ${ICON_PREV}
      </button>
      <button type="button" class="sobree-review-dock__btn" data-action="next"
              title="Next change" aria-label="Next change">
        ${ICON_NEXT}
      </button>
      <span class="sobree-review-dock__divider"></span>
      <button type="button" class="sobree-review-dock__btn is-accept"
              data-action="accept-all"
              title="Accept all changes" aria-label="Accept all changes">
        ${ICON_CHECK} <span class="sobree-review-dock__btn-label">All</span>
      </button>
      <button type="button" class="sobree-review-dock__btn is-reject"
              data-action="reject-all"
              title="Reject all changes" aria-label="Reject all changes">
        ${ICON_CROSS} <span class="sobree-review-dock__btn-label">All</span>
      </button>
    `;
  }
}

const ICON_PREV = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>`;
const ICON_NEXT = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`;
const ICON_CHECK = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICON_CROSS = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>`;
