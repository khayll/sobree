/**
 * Caret <-> character-offset helpers for editable textbox frames.
 *
 * A frame's body is a contentEditable island whose text isn't addressable
 * by the body's block-registry `Selection` model. Undo/redo still needs to
 * capture the caret on a frame edit and put it back afterwards, so we
 * model a frame caret as a single character offset across the frame's text
 * nodes — stable enough to survive the AST round-trip and clamp cleanly to
 * the (possibly shorter) post-undo text.
 */

/**
 * Character offset of the collapsed caret within `root`, counting text
 * across every descendant text node. `null` when the selection isn't
 * inside `root` (the caller then has no frame caret to restore).
 */
export function caretCharOffset(root: HTMLElement, doc: Document): number | null {
  const sel = doc.getSelection();
  const anchorNode = sel?.anchorNode ?? null;
  if (!anchorNode || !root.contains(anchorNode)) return null;

  let offset = 0;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    // Caret anchored on a text node: add the in-node offset and stop.
    if (anchorNode.nodeType === Node.TEXT_NODE && node === anchorNode) {
      return offset + (sel?.anchorOffset ?? 0);
    }
    // Caret anchored on an element (offset = child index): the first text
    // node at or inside the boundary child marks the position.
    if (
      anchorNode.nodeType === Node.ELEMENT_NODE &&
      atElementBoundary(node, anchorNode as HTMLElement, sel?.anchorOffset ?? 0)
    ) {
      return offset;
    }
    offset += node.data.length;
    node = walker.nextNode() as Text | null;
  }
  return offset;
}

/** True once the walker reaches the element-anchored caret's boundary child. */
function atElementBoundary(textNode: Text, anchorEl: HTMLElement, childIndex: number): boolean {
  const boundary = anchorEl.childNodes[childIndex] ?? null;
  if (!boundary) return false;
  return (
    boundary === textNode ||
    boundary.compareDocumentPosition(textNode) === Node.DOCUMENT_POSITION_CONTAINED_BY
  );
}

/**
 * Place the collapsed caret `offset` characters into `root`, clamped to the
 * end of its text when `offset` runs past what's there (an undo can revert
 * to shorter text). No-op-safe when `root` has no text nodes.
 */
export function placeCaretAtOffset(root: HTMLElement, offset: number, doc: Document): void {
  const sel = doc.getSelection();
  if (!sel) return;
  const range = doc.createRange();

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

  sel.removeAllRanges();
  sel.addRange(range);
}
