/**
 * Discover comment-range highlights in the rendered DOM and describe
 * them with the typed `RenderedCommentRange` shape. The renderer encodes
 * the anchored comment ids as a comma-joined `data-comment-ids` list.
 */

import type { BlockRegistry } from "../internal/blockRegistry";
import { blockRefFromElement } from "./blocks";
import { COMMENT_IDS_ATTR, COMMENT_RANGE_SELECTOR } from "./selectors";
import type { RenderedCommentRange } from "./types";

/** Parse a `data-comment-ids="1,3,5"` value into trimmed, non-empty ids. */
function parseCommentIds(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function range(el: HTMLElement, registry: BlockRegistry): RenderedCommentRange {
  const commentIds = parseCommentIds(el.getAttribute(COMMENT_IDS_ATTR));
  const blockRef = blockRefFromElement(el, registry) ?? undefined;
  const r: RenderedCommentRange = { element: el, commentIds };
  if (blockRef !== undefined) r.blockRef = blockRef;
  return r;
}

/** Every comment range under `root`. */
export function commentRanges(root: ParentNode, registry: BlockRegistry): RenderedCommentRange[] {
  const out: RenderedCommentRange[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(COMMENT_RANGE_SELECTOR)) {
    out.push(range(el, registry));
  }
  return out;
}

/** Nearest comment range at or above `target`, or `null`. */
export function nearestCommentRange(
  target: Element,
  registry: BlockRegistry,
): RenderedCommentRange | null {
  const el = target.closest<HTMLElement>(COMMENT_RANGE_SELECTOR);
  return el ? range(el, registry) : null;
}
