import type { Editor } from "@sobree/core";
import {
  BLOCK_KINDS,
  type BlockTarget,
  blockTargetFrom,
  blockTargetFromNode,
  iconSvg,
} from "./blockKinds";

export interface IndicatorOptions {
  stackRoot: HTMLElement;
  /** Editor instance — used for the `selection` event subscription so
   *  the indicator doesn't have to listen to the global document event. */
  editor: Editor;
  /** Fires when the user clicks the indicator (Esc also triggers this). */
  onActivate: (target: BlockTarget) => void;
}

/**
 * Single floating indicator pinned to the left edge of the paper, at the
 * vertical offset of whatever block is currently being hovered or has
 * the selection / caret.
 *
 * Not one-per-block — one element that moves. Matches Sobree's "quiet
 * gutter" rule: the indicator shows the current block, nothing more.
 */
export class BlockIndicator {
  private readonly stackRoot: HTMLElement;
  private readonly editor: Editor;
  private readonly onActivate: (target: BlockTarget) => void;
  private readonly root: HTMLButtonElement;
  private current: BlockTarget | null = null;
  private enabled = true;

  private readonly onHoverFn = (e: MouseEvent) => this.handleHover(e);
  private readonly onStackLeaveFn = () => this.maybeHide();
  private readonly onKeyFn = (e: KeyboardEvent) => this.handleKey(e);
  private readonly detachSelection: () => void;

  constructor(opts: IndicatorOptions) {
    this.stackRoot = opts.stackRoot;
    this.editor = opts.editor;
    this.onActivate = opts.onActivate;

    this.root = document.createElement("button");
    this.root.type = "button";
    this.root.className = "sobree-block-indicator";
    this.root.contentEditable = "false";
    this.root.setAttribute("aria-label", "Open block tools");
    // The indicator opens the floating toolbar — a dialog-like surface
    // from an a11y standpoint (anchored, dismissible, contains controls).
    this.root.setAttribute("aria-haspopup", "dialog");
    this.root.setAttribute("aria-expanded", "false");

    // The stack needs to be a positioning context so the indicator follows
    // its paper-space coordinates through any viewport transforms.
    if (!this.stackRoot.style.position) this.stackRoot.style.position = "relative";
    this.stackRoot.appendChild(this.root);

    // Clicks on the indicator must not move the caret.
    this.root.addEventListener("mousedown", (e) => e.preventDefault());
    this.root.addEventListener("click", (e) => {
      e.preventDefault();
      if (this.current) this.onActivate(this.current);
    });

    this.stackRoot.addEventListener("mousemove", this.onHoverFn);
    this.stackRoot.addEventListener("mouseleave", this.onStackLeaveFn);
    this.detachSelection = opts.editor.on("selection", () => this.handleSelectionChange());
    document.addEventListener("keydown", this.onKeyFn);
  }

  destroy(): void {
    this.stackRoot.removeEventListener("mousemove", this.onHoverFn);
    this.stackRoot.removeEventListener("mouseleave", this.onStackLeaveFn);
    this.detachSelection();
    document.removeEventListener("keydown", this.onKeyFn);
    this.root.remove();
  }

  /** Currently-tracked block, or `null` if the indicator is hidden. */
  getCurrent(): BlockTarget | null {
    return this.current;
  }

  /** Visually flag the indicator as "active" (toolbar is open for it). */
  setActive(active: boolean): void {
    this.root.classList.toggle("is-active", active);
    this.root.setAttribute("aria-expanded", String(active));
  }

  /**
   * Enable or disable the indicator entirely. Disabled = hidden and
   * inert (hover / selection / Esc do nothing). Used to suspend the
   * block UI while Sobree is in read mode.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.current = null;
      this.root.classList.remove("is-visible", "is-active");
    }
  }

  /** Recompute position. Call after pagination or viewport zoom changes. */
  refresh(): void {
    if (!this.current) return;
    // Re-resolve element if the body was re-rendered under us.
    if (this.current.blockId && !document.contains(this.current.element)) {
      const fresh = this.editor.renderedDocument.elementForBlockId(this.current.blockId);
      if (fresh) {
        const paper = fresh.closest(".paper") as HTMLElement | null;
        if (paper) this.current = { ...this.current, element: fresh, paper };
      } else {
        // Block was deleted — hide.
        this.current = null;
        this.root.classList.remove("is-visible", "is-active");
        return;
      }
    }
    this.position(this.current);
  }

  // ---- handlers ----

  private handleHover(e: MouseEvent): void {
    if (!this.enabled) return;
    const target = e.target as HTMLElement;
    if (this.root.contains(target)) return;
    const block = blockTargetFrom(target, this.stackRoot, this.editor.renderedDocument);
    if (block) this.setTarget(block);
  }

  private handleSelectionChange(): void {
    if (!this.enabled) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const anchor = sel.anchorNode;
    if (!anchor) return;
    if (!this.stackRoot.contains(anchor)) return;
    const block = blockTargetFromNode(anchor, this.stackRoot, this.editor.renderedDocument);
    if (block) this.setTarget(block);
  }

  private handleKey(e: KeyboardEvent): void {
    if (!this.enabled) return;
    if (e.key !== "Escape") return;
    if (!this.current) return;
    // Esc on a visible indicator → treat as if the user clicked it.
    // The orchestrator's `onActivate` handler toggles the toolbar.
    this.onActivate(this.current);
  }

  private maybeHide(): void {
    // Only fade out when the mouse leaves the stack. Keep the indicator
    // visible when it's pinned by a selection.
    const sel = window.getSelection();
    const hasSelInStack =
      sel && sel.rangeCount > 0 && sel.anchorNode && this.stackRoot.contains(sel.anchorNode);
    if (hasSelInStack) return;
    this.current = null;
    this.root.classList.remove("is-visible");
  }

  private setTarget(target: BlockTarget): void {
    const same = this.current?.element === target.element && this.current.kind === target.kind;
    if (same) return;
    this.current = target;
    this.root.dataset.kind = target.kind;
    this.root.title = BLOCK_KINDS[target.kind].label;
    this.root.innerHTML = iconSvg(BLOCK_KINDS[target.kind]);
    this.root.classList.add("is-visible");
    this.position(target);
  }

  private position(target: BlockTarget): void {
    const scale = this.effectiveScale();
    const stackRect = this.stackRoot.getBoundingClientRect();
    const paperRect = target.paper.getBoundingClientRect();
    const blockRect = target.element.getBoundingClientRect();
    const left = (paperRect.left - stackRect.left) / scale;
    const top = (blockRect.top - stackRect.top) / scale;
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
  }

  /** Effective CSS-pixel scale applied by any viewport transform ancestor. */
  private effectiveScale(): number {
    if (this.stackRoot.offsetWidth === 0) return 1;
    return this.stackRoot.getBoundingClientRect().width / this.stackRoot.offsetWidth;
  }
}
