/**
 * Selection preservation across a DOM rebuild.
 *
 * Repagination rebuilds the paper DOM (and re-renders tables that split
 * across pages), so raw `(node, offset)` selection references don't
 * survive — restoring them silently drops the caret to the top of the
 * page. A {@link SelectionDescriptor} captures the selection in MODEL
 * terms ({@link BlockPoint}: `data-block-id` + offset + cell address),
 * which re-resolves against the rebuilt DOM by id.
 *
 * This is shared page-DOM lifecycle behaviour, not editor-private: the
 * `PaperStack` — which performs the rebuild — captures before and restores
 * after. It lives here (a non-internal editor module) rather than under
 * `editor/internal/` so `paperStack` can depend on it without reaching
 * into editor internals. The DOM ↔ `BlockPoint` mapping it builds on stays
 * owned by `editor/internal/positionMap`.
 */

import { type BlockPoint, blockPointFromDom, domPointFromBlockPoint } from "./internal/positionMap";

export interface SelectionDescriptor {
  start: BlockPoint;
  end: BlockPoint;
  collapsed: boolean;
}

/** Capture the live selection as a {@link SelectionDescriptor}, or null. */
export function captureSelectionDescriptor(
  hosts: readonly HTMLElement[],
): SelectionDescriptor | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const start = blockPointFromDom(hosts, range.startContainer, range.startOffset);
  if (!start) return null;
  const end = sel.isCollapsed
    ? start
    : (blockPointFromDom(hosts, range.endContainer, range.endOffset) ?? start);
  return { start, end, collapsed: sel.isCollapsed };
}

/** Restore a {@link SelectionDescriptor} to the live DOM (after a rebuild). */
export function applySelectionDescriptor(
  hosts: readonly HTMLElement[],
  desc: SelectionDescriptor | null,
): boolean {
  if (!desc) return false;
  const startPt = domPointFromBlockPoint(hosts, desc.start);
  const endPt = desc.collapsed ? startPt : domPointFromBlockPoint(hosts, desc.end);
  if (!startPt || !endPt) return false;
  const sel = window.getSelection();
  if (!sel) return false;
  const range = document.createRange();
  range.setStart(startPt.node, startPt.offset);
  range.setEnd(endPt.node, endPt.offset);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}
