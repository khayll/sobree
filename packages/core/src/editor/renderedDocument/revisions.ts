/**
 * Discover tracked-change marks in the rendered DOM and describe them
 * with the typed `RenderedRevisionMark` shape. The renderer nests the
 * wrappers (comment > ins/del > format), so `nearestRevisionMark` checks
 * most-specific first — inline, then format, then paragraph.
 */

import type { BlockRegistry } from "../internal/blockRegistry";
import { blockRefFromElement } from "./blocks";
import {
  BLOCK_REVISION_AUTHOR_ATTR,
  BLOCK_REVISION_DATE_ATTR,
  BLOCK_REVISION_SELECTOR,
  CLS_REVISION,
  CLS_REVISION_FORMAT,
  FORMAT_REVISION_SELECTOR,
  INLINE_REVISION_SELECTOR,
  REVISION_AUTHOR_ATTR,
  REVISION_DATE_ATTR,
  REVISION_FORMAT_AUTHOR_ATTR,
  REVISION_FORMAT_DATE_ATTR,
} from "./selectors";
import type { RenderedRevisionKind, RenderedRevisionMark } from "./types";

function attr(el: Element, name: string): string | undefined {
  return el.getAttribute(name) ?? undefined;
}

/** Build a mark from an inline `<ins>` / `<del>` element. */
function inlineMark(el: HTMLElement, registry: BlockRegistry): RenderedRevisionMark {
  const kind: RenderedRevisionKind =
    el.tagName.toLowerCase() === "del" ? "inline-delete" : "inline-insert";
  return mark(kind, el, attr(el, REVISION_AUTHOR_ATTR), attr(el, REVISION_DATE_ATTR), registry);
}

/** Build a mark from a format-change `<span>`. */
function formatMark(el: HTMLElement, registry: BlockRegistry): RenderedRevisionMark {
  return mark(
    "format",
    el,
    attr(el, REVISION_FORMAT_AUTHOR_ATTR),
    attr(el, REVISION_FORMAT_DATE_ATTR),
    registry,
  );
}

/** Build a mark from a paragraph-mark revision (the block element). */
function paragraphMark(el: HTMLElement, registry: BlockRegistry): RenderedRevisionMark {
  return mark(
    "paragraph",
    el,
    attr(el, BLOCK_REVISION_AUTHOR_ATTR),
    attr(el, BLOCK_REVISION_DATE_ATTR),
    registry,
  );
}

function mark(
  kind: RenderedRevisionKind,
  element: HTMLElement,
  author: string | undefined,
  date: string | undefined,
  registry: BlockRegistry,
): RenderedRevisionMark {
  const blockRef = blockRefFromElement(element, registry) ?? undefined;
  const m: RenderedRevisionMark = { kind, element };
  if (author !== undefined) m.author = author;
  if (date !== undefined) m.date = date;
  if (blockRef !== undefined) m.blockRef = blockRef;
  return m;
}

/** Every revision mark under `root` — inline, paragraph, then format. */
export function revisionMarks(root: ParentNode, registry: BlockRegistry): RenderedRevisionMark[] {
  const out: RenderedRevisionMark[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(INLINE_REVISION_SELECTOR)) {
    out.push(inlineMark(el, registry));
  }
  for (const el of root.querySelectorAll<HTMLElement>(BLOCK_REVISION_SELECTOR)) {
    out.push(paragraphMark(el, registry));
  }
  for (const el of root.querySelectorAll<HTMLElement>(FORMAT_REVISION_SELECTOR)) {
    out.push(formatMark(el, registry));
  }
  return out;
}

/**
 * Nearest revision mark at or above `target`. Specificity order matches
 * the renderer's nesting: an inserted + format-changed run is wrapped in
 * BOTH, and accepting the inline insert covers the format change too, so
 * the inline mark wins.
 */
export function nearestRevisionMark(
  target: Element,
  registry: BlockRegistry,
): RenderedRevisionMark | null {
  const inline = target.closest<HTMLElement>(`.${CLS_REVISION}`);
  if (inline) return inlineMark(inline, registry);
  const format = target.closest<HTMLElement>(`.${CLS_REVISION_FORMAT}`);
  if (format) return formatMark(format, registry);
  const para = target.closest<HTMLElement>(BLOCK_REVISION_SELECTOR);
  if (para) return paragraphMark(para, registry);
  return null;
}
