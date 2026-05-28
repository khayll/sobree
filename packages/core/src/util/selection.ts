/**
 * Save and restore the current document selection as a pair of (node, offset)
 * pairs. Works across block re-parenting because text nodes are referenced
 * directly — only breaks when the saved node is actually removed from the DOM.
 */

export interface SavedSelection {
  startContainer: Node;
  startOffset: number;
  endContainer: Node;
  endOffset: number;
}

export function saveSelection(): SavedSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  return {
    startContainer: r.startContainer,
    startOffset: r.startOffset,
    endContainer: r.endContainer,
    endOffset: r.endOffset,
  };
}

export function restoreSelection(saved: SavedSelection | null): void {
  if (!saved) return;
  if (!document.contains(saved.startContainer) || !document.contains(saved.endContainer)) return;
  try {
    const range = document.createRange();
    range.setStart(saved.startContainer, saved.startOffset);
    range.setEnd(saved.endContainer, saved.endOffset);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch {
    // Saved offsets may be invalid after layout shift — give up silently.
  }
}
