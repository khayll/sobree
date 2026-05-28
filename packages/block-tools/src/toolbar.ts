import type { BlockTarget } from "./blockKinds";
import type { Viewport } from "@sobree/core";

export interface FloatingToolbarOptions {
  /**
   * Stack root — used to re-resolve the target element by `data-block-id`
   * after a commit replaces the body DOM.
   */
  stackRoot: HTMLElement;
  /**
   * Rendering area — the element inside which the toolbar must fit.
   * Typically the demo viewport (`.demo-viewport`). Used for Case-A
   * stick-to-top and Case-C panning calculations.
   */
  renderingArea: HTMLElement;
  /** Optional viewport handle — used for the animated pan in Case C. */
  viewport?: Viewport | null;
}

/**
 * Floating toolbar shell. Positions itself above the active block
 * according to the three rules:
 *   A. Block is taller than the visible area → toolbar sticks to the
 *      top of the rendering area and floats over the block.
 *   B. Block fits and there's room above → toolbar sits 8px above it.
 *   C. Block fits but toolbar would clip outside the rendering area →
 *      animate a viewport pan so the toolbar nestles between block-top
 *      and rendering-area-top.
 *
 * B2 scope: shell only. Contents are set via `setContent(html)` from
 * whatever tool module owns the current block kind; wiring those up is
 * B3–B5.
 */
export class FloatingToolbar {
  readonly root: HTMLElement;
  private readonly stackRoot: HTMLElement;
  private readonly renderingArea: HTMLElement;
  private readonly viewport: Viewport | null;
  private target: BlockTarget | null = null;
  private readonly onScrollOrResizeFn = () => this.reposition();

  constructor(opts: FloatingToolbarOptions) {
    this.stackRoot = opts.stackRoot;
    this.renderingArea = opts.renderingArea;
    this.viewport = opts.viewport ?? null;

    this.root = document.createElement("div");
    this.root.className = "sobree-block-toolbar";
    this.root.contentEditable = "false";
    this.root.setAttribute("role", "toolbar");
    this.root.setAttribute("aria-label", "Block tools");
    // Wraps onto a second line on narrow screens (CSS handles the wrap),
    // but the SR announcement still treats children as a single
    // horizontal cluster — that matches the visual mental model better
    // than `vertical` would after a wrap.
    this.root.setAttribute("aria-orientation", "horizontal");
    // Appended to body (not stack) so it floats at viewport coordinates
    // and isn't affected by the stack's zoom transform.
    document.body.appendChild(this.root);

    // Mousedown inside the toolbar mustn't steal caret focus.
    this.root.addEventListener("mousedown", (e) => {
      const target = e.target as HTMLElement;
      // Inputs and selects still need focus — let them get it.
      if (target.closest("input, select, textarea, [contenteditable=true]")) return;
      e.preventDefault();
    });

    this.renderingArea.addEventListener("scroll", this.onScrollOrResizeFn, {
      passive: true,
    });
    window.addEventListener("resize", this.onScrollOrResizeFn);
  }

  destroy(): void {
    this.renderingArea.removeEventListener("scroll", this.onScrollOrResizeFn);
    window.removeEventListener("resize", this.onScrollOrResizeFn);
    this.root.remove();
  }

  /** Currently-targeted block, if the toolbar is open. */
  getTarget(): BlockTarget | null {
    return this.target;
  }

  /** Whether the toolbar is currently open. */
  isOpen(): boolean {
    return this.root.classList.contains("is-open");
  }

  /** Replace the toolbar's inner HTML. Callers own the event wiring. */
  setContent(html: string): void {
    this.root.innerHTML = html;
  }

  /** Listen for clicks inside the toolbar (delegated). Returns an unsubscribe. */
  onClick(handler: (e: MouseEvent) => void): () => void {
    this.root.addEventListener("click", handler);
    return () => this.root.removeEventListener("click", handler);
  }

  /** Listen for input/change on form controls inside the toolbar. */
  onInput(handler: (e: Event) => void): () => void {
    this.root.addEventListener("input", handler);
    this.root.addEventListener("change", handler);
    return () => {
      this.root.removeEventListener("input", handler);
      this.root.removeEventListener("change", handler);
    };
  }

  /** Open the toolbar for `target`. Triggers positioning + panning as needed. */
  open(target: BlockTarget): void {
    this.target = target;
    this.root.dataset.kind = target.kind;
    this.root.classList.add("is-open");
    // Pan-then-reposition so the final resting position is inside the
    // rendering area whenever possible.
    this.maybePanIntoView(target);
    this.reposition();
  }

  close(): void {
    this.target = null;
    this.root.classList.remove("is-open");
    this.root.classList.remove("is-stuck");
    this.root.removeAttribute("data-kind");
  }

  toggle(target: BlockTarget): void {
    if (this.isOpen() && this.target?.element === target.element) this.close();
    else this.open(target);
  }

  /** Recompute positioning — call after scroll, zoom, or pagination. */
  reposition(): void {
    if (!this.target) return;
    // Re-resolve the target element if it was detached by a commit that
    // rebuilt the body DOM. `data-block-id` is stamped by the renderer.
    if (this.target.blockId && !document.contains(this.target.element)) {
      const fresh = this.stackRoot.querySelector(
        `[data-block-id="${this.target.blockId}"]`,
      ) as HTMLElement | null;
      if (fresh) {
        const paper = fresh.closest(".paper") as HTMLElement | null;
        if (paper) this.target = { ...this.target, element: fresh, paper };
      } else {
        // Block was deleted — nothing to anchor to.
        this.close();
        return;
      }
    }
    const rendArea = this.renderingArea.getBoundingClientRect();
    // Cap width to the rendering area so the toolbar wraps to a second
    // line when its contents would otherwise overflow. Do this BEFORE
    // reading the block rect so the offsetHeight reflects the wrapped
    // (possibly two-line) layout.
    const margin = 8;
    const maxWidth = Math.max(240, rendArea.width - margin * 2);
    this.root.style.maxWidth = `${maxWidth}px`;
    const blockRect = this.target.element.getBoundingClientRect();
    const tbHeight = this.root.offsetHeight || 40;

    // Case A — block taller than the visible area: stick to the top of
    // the rendering area. Re-evaluated on every call so scrolling a
    // medium block into "tall relative to what's showing" flips it.
    const blockTallerThanView = blockRect.height > rendArea.height;
    // Also stick when the block's top has scrolled above the rendering
    // area — the user is inside a large block that spills upward.
    const blockTopAboveView = blockRect.top < rendArea.top;
    const stickToTop = blockTallerThanView || blockTopAboveView;

    let top: number;
    let left = Math.max(
      rendArea.left + margin,
      Math.min(blockRect.left, rendArea.right - this.root.offsetWidth - margin),
    );

    if (stickToTop) {
      top = rendArea.top + margin;
    } else {
      top = blockRect.top - tbHeight - margin;
      // Case B: natural fit. We already panned into view in `open`.
      // If after scrolling the toolbar ends up above the rendering
      // area, clamp.
      if (top < rendArea.top + margin) top = rendArea.top + margin;
    }

    // Clamp to window horizontally as a final safety net.
    left = Math.max(
      0,
      Math.min(left, window.innerWidth - this.root.offsetWidth),
    );

    this.root.style.top = `${top}px`;
    this.root.style.left = `${left}px`;
    this.root.classList.toggle("is-stuck", stickToTop);
  }

  /**
   * Case C: if the block is small but the toolbar wouldn't fit above it
   * within the rendering area, animate the viewport so the block shifts
   * down by `toolbarHeight + margin`.
   */
  private maybePanIntoView(target: BlockTarget): void {
    if (!this.viewport) return;
    const rendArea = this.renderingArea.getBoundingClientRect();
    const blockRect = target.element.getBoundingClientRect();
    const tbHeight = this.root.offsetHeight || 40;
    const margin = 8;

    // If the block is too tall, we'll stick-to-top instead; no pan.
    if (blockRect.height > rendArea.height) return;
    // If there's already room above, nothing to do.
    const roomAbove = blockRect.top - rendArea.top;
    const needed = tbHeight + margin * 2;
    if (roomAbove >= needed) return;
    // Also skip if the block top is already above the rendering area —
    // we'll stick-to-top, not pan.
    if (blockRect.top < rendArea.top) return;

    const deficit = needed - roomAbove;
    this.viewport.panBy(0, -deficit, { animate: true });
  }
}
