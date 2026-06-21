/**
 * Preserve caret + focus across an editable-textbox-frame repaint.
 *
 * An AST-driven repaint (undo / redo / remote / body edit) rebuilds the
 * anchor overlay from scratch — `overlay.replaceChildren(...)` detaches the
 * frame element the caret was sitting in, so focus drops to `<body>` and the
 * next `Cmd+Z` no longer routes to the editor until the user clicks back in.
 * (Live typing skips the repaint entirely, so this only fires for the
 * structural-change paths.)
 *
 * Wrap the repaint: if a frame in this overlay holds the caret, remember its
 * anchor id and the caret's character offset, then after the swap refocus the
 * frame with the same id and put the caret back where it was (clamped to the
 * possibly-shorter post-undo text).
 */
export function withPreservedFrameFocus(overlay: HTMLElement, repaint: () => void): void {
  const doc = overlay.ownerDocument;
  const active = doc.activeElement;
  const frame =
    active instanceof HTMLElement && overlay.contains(active)
      ? active.closest<HTMLElement>(".paper-anchor[data-anchor-textbox]")
      : null;
  const anchorId = frame?.dataset.anchorId;
  if (!frame || !anchorId) {
    repaint();
    return;
  }

  const caretOffset = caretCharOffset(frame, doc);
  repaint();

  const next = Array.from(
    overlay.querySelectorAll<HTMLElement>(".paper-anchor[data-anchor-textbox]"),
  ).find((el) => el.dataset.anchorId === anchorId);
  if (!next) return;
  next.focus({ preventScroll: true });
  restoreCaret(next, caretOffset, doc);
}

/**
 * Character offset of the collapsed caret within `root`, counting text across
 * every descendant text node. `null` when the selection isn't inside `root`
 * (then the caller falls back to the end of the frame).
 */
function caretCharOffset(root: HTMLElement, doc: Document): number | null {
  const sel = doc.getSelection();
  const anchorNode = sel?.anchorNode ?? null;
  if (!anchorNode || !root.contains(anchorNode)) return null;

  // Caret anchored on an element node: its offset is a CHILD index, so sum
  // the text of the children before it. Anchored on a text node: sum the
  // preceding text nodes, then add the in-node offset.
  let offset = 0;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (anchorNode.nodeType === Node.TEXT_NODE && node === anchorNode) {
      return offset + (sel?.anchorOffset ?? 0);
    }
    if (
      anchorNode.nodeType === Node.ELEMENT_NODE &&
      isBeforeChildBoundary(node, anchorNode as HTMLElement, sel?.anchorOffset ?? 0)
    ) {
      return offset;
    }
    offset += node.data.length;
    node = walker.nextNode() as Text | null;
  }
  return offset;
}

/** True once the walker has passed the element-anchored caret boundary. */
function isBeforeChildBoundary(textNode: Text, anchorEl: HTMLElement, childIndex: number): boolean {
  const boundary = anchorEl.childNodes[childIndex] ?? null;
  if (!boundary) return false;
  // The first text node at or after the boundary child marks the caret.
  return (
    boundary === textNode ||
    boundary.compareDocumentPosition(textNode) === Node.DOCUMENT_POSITION_CONTAINED_BY
  );
}

/** Place the collapsed caret `offset` characters into `root`, or at its end
 *  when `offset` is null or runs past the available text. */
function restoreCaret(root: HTMLElement, offset: number | null, doc: Document): void {
  const sel = doc.getSelection();
  if (!sel) return;
  const range = doc.createRange();

  if (offset === null) {
    range.selectNodeContents(root);
    range.collapse(false);
  } else {
    let remaining = offset;
    let last: Text | null = null;
    let placed = false;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node) {
      last = node;
      if (remaining <= node.data.length) {
        range.setStart(node, remaining);
        placed = true;
        break;
      }
      remaining -= node.data.length;
      node = walker.nextNode() as Text | null;
    }
    if (!placed) {
      if (last) range.setStart(last, last.data.length);
      else range.selectNodeContents(root);
    }
    range.collapse(true);
  }

  sel.removeAllRanges();
  sel.addRange(range);
}
