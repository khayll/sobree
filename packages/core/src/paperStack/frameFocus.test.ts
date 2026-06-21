import { beforeEach, describe, expect, it } from "vitest";
import { withPreservedFrameFocus } from "./frameFocus";

/** An overlay holding one editable frame whose text is `text`. */
function overlayWith(anchorId: string, text: string): { overlay: HTMLElement; frame: HTMLElement } {
  const overlay = document.createElement("div");
  const frame = document.createElement("div");
  frame.className = "paper-anchor";
  frame.dataset.anchorTextbox = "";
  frame.dataset.anchorId = anchorId;
  frame.contentEditable = "true";
  frame.tabIndex = 0;
  frame.append(document.createElement("p"));
  frame.querySelector("p")!.textContent = text;
  overlay.append(frame);
  document.body.append(overlay);
  return { overlay, frame };
}

/** Simulate the repaint: same-id frame, possibly different text. */
function repaintWith(overlay: HTMLElement, anchorId: string, text: string): void {
  const frame = document.createElement("div");
  frame.className = "paper-anchor";
  frame.dataset.anchorTextbox = "";
  frame.dataset.anchorId = anchorId;
  frame.contentEditable = "true";
  frame.tabIndex = 0;
  const p = document.createElement("p");
  p.textContent = text;
  frame.append(p);
  overlay.replaceChildren(frame);
}

function caretOffsetIn(root: HTMLElement): number | null {
  const sel = document.getSelection();
  const node = sel?.anchorNode;
  if (!node || !root.contains(node)) return null;
  return sel?.anchorOffset ?? null;
}

describe("withPreservedFrameFocus", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("refocuses the same-id frame after the overlay is replaced", () => {
    const { overlay, frame } = overlayWith("anchor-1", "Heading");
    frame.focus();
    const tn = frame.querySelector("p")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(tn, 3);
    range.collapse(true);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    withPreservedFrameFocus(overlay, () => repaintWith(overlay, "anchor-1", "Heading"));

    const next = overlay.querySelector<HTMLElement>('[data-anchor-id="anchor-1"]')!;
    expect(document.activeElement).toBe(next);
    expect(caretOffsetIn(next)).toBe(3); // caret offset preserved
  });

  it("clamps the caret to the end when the post-repaint text is shorter", () => {
    const { overlay, frame } = overlayWith("anchor-2", "Heading text");
    frame.focus();
    const tn = frame.querySelector("p")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(tn, 12); // caret at the very end of the old, longer text
    range.collapse(true);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    // Undo reverted to shorter text.
    withPreservedFrameFocus(overlay, () => repaintWith(overlay, "anchor-2", "Hi"));

    const next = overlay.querySelector<HTMLElement>('[data-anchor-id="anchor-2"]')!;
    expect(document.activeElement).toBe(next);
    expect(caretOffsetIn(next)).toBe(2); // clamped to "Hi".length
  });

  it("does nothing special when no frame in the overlay is focused", () => {
    const { overlay } = overlayWith("anchor-3", "x");
    document.body.focus();
    let painted = false;
    withPreservedFrameFocus(overlay, () => {
      painted = true;
      repaintWith(overlay, "anchor-3", "x");
    });
    expect(painted).toBe(true);
    expect(document.activeElement).not.toBe(overlay.querySelector('[data-anchor-id="anchor-3"]'));
  });

  it("skips restore when the focused frame's id is gone after repaint", () => {
    const { overlay, frame } = overlayWith("anchor-4", "x");
    frame.focus();
    // Frame removed entirely (e.g. deleted by the undone op).
    expect(() => withPreservedFrameFocus(overlay, () => overlay.replaceChildren())).not.toThrow();
  });
});
