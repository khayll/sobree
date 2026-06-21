/**
 * Selection <-> character-offset helpers for editable textbox frames.
 *
 * A frame's body is a contentEditable island whose text isn't addressable
 * by the body's block-registry `Selection` model. Undo/redo still needs to
 * capture the caret (or selection) on a frame edit and put it back, so we
 * model a frame selection as a `{ start, end }` character span across the
 * frame's text nodes — stable enough to survive the AST round-trip and
 * clamp cleanly to the (possibly shorter) post-undo text. A collapsed
 * caret is `start === end`.
 */

export interface FrameOffsets {
  /** Character offset of the selection start within the frame. */
  start: number;
  /** Character offset of the selection end (=== start for a caret). */
  end: number;
}

/**
 * The current selection's `{ start, end }` character offsets within `root`,
 * or `null` when the selection isn't anchored inside `root`. Normalised so
 * `start <= end` regardless of selection direction.
 */
export function frameSelectionOffsets(root: HTMLElement, doc: Document): FrameOffsets | null {
  const sel = doc.getSelection();
  if (!sel || sel.anchorNode == null) return null;
  if (!root.contains(sel.anchorNode)) return null;

  const anchor = charOffsetOf(root, sel.anchorNode, sel.anchorOffset, doc);
  // A collapsed caret shares anchor/focus; only walk twice for a real range.
  const focus =
    sel.focusNode === sel.anchorNode && sel.focusOffset === sel.anchorOffset
      ? anchor
      : sel.focusNode && root.contains(sel.focusNode)
        ? charOffsetOf(root, sel.focusNode, sel.focusOffset, doc)
        : anchor;
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
}

/**
 * Character offset of the collapsed caret within `root` (selection start),
 * or `null` when the selection isn't inside `root`. Thin wrapper over
 * {@link frameSelectionOffsets} for caret-only callers.
 */
export function caretCharOffset(root: HTMLElement, doc: Document): number | null {
  return frameSelectionOffsets(root, doc)?.start ?? null;
}

/**
 * Select `start..end` characters within `root` (a collapsed caret when
 * equal), clamping each end to the available text — an undo can revert to
 * shorter text. No-op-safe when `root` has no text nodes.
 */
export function applyFrameSelection(root: HTMLElement, offsets: FrameOffsets, doc: Document): void {
  const sel = doc.getSelection();
  if (!sel) return;
  const startPos = locateOffset(root, offsets.start, doc);
  const endPos = offsets.end === offsets.start ? startPos : locateOffset(root, offsets.end, doc);

  const range = doc.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Place a collapsed caret `offset` chars into `root` (clamped). */
export function placeCaretAtOffset(root: HTMLElement, offset: number, doc: Document): void {
  applyFrameSelection(root, { start: offset, end: offset }, doc);
}

/** Char offset of a DOM (node, offset) position within `root`. */
function charOffsetOf(root: HTMLElement, node: Node, nodeOffset: number, doc: Document): number {
  let acc = 0;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode() as Text | null;
  while (textNode) {
    if (node.nodeType === Node.TEXT_NODE && textNode === node) {
      return acc + nodeOffset;
    }
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      atElementBoundary(textNode, node as HTMLElement, nodeOffset)
    ) {
      return acc;
    }
    acc += textNode.data.length;
    textNode = walker.nextNode() as Text | null;
  }
  return acc;
}

/** True once the walker reaches the element-anchored position's boundary child. */
function atElementBoundary(textNode: Text, anchorEl: HTMLElement, childIndex: number): boolean {
  const boundary = anchorEl.childNodes[childIndex] ?? null;
  if (!boundary) return false;
  return (
    boundary === textNode ||
    boundary.compareDocumentPosition(textNode) === Node.DOCUMENT_POSITION_CONTAINED_BY
  );
}

/** Resolve a character offset within `root` to a DOM (node, offset) caret
 *  position, clamped to the end of the available text. */
function locateOffset(
  root: HTMLElement,
  offset: number,
  doc: Document,
): { node: Node; offset: number } {
  let remaining = offset;
  let last: Text | null = null;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    last = node;
    if (remaining <= node.data.length) return { node, offset: remaining };
    remaining -= node.data.length;
    node = walker.nextNode() as Text | null;
  }
  if (last) return { node: last, offset: last.data.length };
  return { node: root, offset: 0 };
}
