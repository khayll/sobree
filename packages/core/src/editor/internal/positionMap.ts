import type { InlinePosition, Range as ApiRange, Selection } from "../../doc/api";
import type { BlockRegistry } from "./blockRegistry";

/**
 * Bidirectional mapping between DOM points and the model's
 * `InlinePosition` / `Range` / `Selection`.
 *
 * The Editor owns one of these (implicitly, via the helper functions
 * here) and calls into it whenever the UI side of selection has to talk
 * to the data side, or vice versa. It's the ONLY place that knows how
 * to convert DOM coordinates into character offsets and back.
 *
 * Character counting rules (must match the DOM serializer):
 *   - Text node → its `.length` characters.
 *   - `<br>`, `<img>` → 1 character each.
 *   - Wrapper elements (`<span>`, `<strong>`, `<em>`, `<b>`, `<i>`,
 *     `<u>`, `<ins>`, `<s>`, `<del>`, `<strike>`, `<sub>`, `<sup>`,
 *     `<mark>`, `<code>`, `<a>`) → transparent; recurse into children.
 *
 * Scope for this module:
 *   - Paragraph / heading blocks: full support.
 *   - List items: each `<li>` is its own block (matching how the DOM
 *     serializer splits `<ul>`/`<ol>` into per-item paragraphs).
 *   - Tables: a point inside a table resolves to the enclosing table
 *     block with `offset = 0`. Cell-internal positioning comes later.
 */

const WRAPPER_TAGS = new Set([
  "span",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "ins",
  "s",
  "del",
  "strike",
  "sub",
  "sup",
  "mark",
  "code",
  "a",
]);

const ATOM_TAGS = new Set(["br", "img", "hr"]);

const BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "dl",
]);

const LIST_TAGS = new Set(["ul", "ol"]);

// === reading: DOM → model ===

/**
 * Resolve a DOM point `(node, offset)` to an `InlinePosition`, or null
 * if the point is outside the editor's tracked blocks.
 *
 * For table cells, returns an InlinePosition at the table block with
 * `offset = 0` — block-internal table addressing is a future extension.
 */
export function positionFromDomPoint(
  hosts: readonly HTMLElement[],
  registry: BlockRegistry,
  node: Node,
  domOffset: number,
): InlinePosition | null {
  if (!hosts.some((h) => h.contains(node) || h === node)) return null;

  const { blockEl, blockIndex } = findBlockElement(node, hosts);
  if (!blockEl || blockIndex < 0) return null;

  let offset: number;
  if (isInsideTable(blockEl)) {
    offset = 0;
  } else {
    offset = charOffsetToPoint(blockEl, node, domOffset);
  }

  return { block: registry.refAt(blockIndex), offset };
}

/** Build an API `Range` from a live DOM `Range`. */
export function rangeFromDomRange(
  hosts: readonly HTMLElement[],
  registry: BlockRegistry,
  range: Range,
): ApiRange | null {
  const from = positionFromDomPoint(hosts, registry, range.startContainer, range.startOffset);
  const to = positionFromDomPoint(hosts, registry, range.endContainer, range.endOffset);
  if (!from || !to) return null;
  return { from, to };
}

/** Read `window.getSelection()` as a model `Selection`. */
export function selectionFromDom(
  hosts: readonly HTMLElement[],
  registry: BlockRegistry,
): Selection {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const api = rangeFromDomRange(hosts, registry, range);
  if (!api) return null;
  if (sel.isCollapsed) return { kind: "caret", at: api.from };
  return { kind: "range", range: api };
}

// === writing: model → DOM ===

/** Resolve an `InlinePosition` to a DOM `{ node, offset }` point. */
export function domPointFromPosition(
  hosts: readonly HTMLElement[],
  registry: BlockRegistry,
  pos: InlinePosition,
): { node: Node; offset: number } | null {
  const index = registry.indexOf(pos.block.id);
  if (index < 0) return null;
  const blockEl = blockElementAtIndex(hosts, index);
  if (!blockEl) return null;
  return findPointAtOffset(blockEl, pos.offset);
}

/** Apply a model `Selection` to `window.getSelection()`. */
export function applySelectionToDom(
  hosts: readonly HTMLElement[],
  registry: BlockRegistry,
  selection: Selection,
): boolean {
  const sel = window.getSelection();
  if (!sel) return false;
  if (!selection) {
    sel.removeAllRanges();
    return true;
  }
  if (selection.kind === "caret") {
    const pt = domPointFromPosition(hosts, registry, selection.at);
    if (!pt) return false;
    const range = document.createRange();
    range.setStart(pt.node, pt.offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }
  const from = domPointFromPosition(hosts, registry, selection.range.from);
  const to = domPointFromPosition(hosts, registry, selection.range.to);
  if (!from || !to) return false;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

// === block length (the key utility used by the rest of the API) ===

/** Total character-count length of a block, per the counting rules above. */
export function blockLength(blockEl: Element): number {
  return charOffsetToPoint(blockEl, blockEl, blockEl.childNodes.length);
}

// === block index helpers ===

/**
 * Enumerate blocks across all content hosts in document order,
 * expanding `<ul>`/`<ol>` children as one block each. Returns the
 * total block count.
 */
export function countBlocks(hosts: readonly HTMLElement[]): number {
  let n = 0;
  for (const host of hosts) {
    for (const child of Array.from(host.children)) n += blocksInTopChild(child);
  }
  return n;
}

/**
 * Return the DOM element that hosts a given block index. For list-item
 * blocks this is the `<li>`; for everything else it's the direct host
 * child.
 */
export function blockElementAtIndex(
  hosts: readonly HTMLElement[],
  index: number,
): HTMLElement | null {
  let remaining = index;
  for (const host of hosts) {
    for (const child of Array.from(host.children)) {
      const span = blocksInTopChild(child);
      if (remaining < span) {
        if (LIST_TAGS.has(child.tagName.toLowerCase())) {
          const items = Array.from(child.children).filter(
            (c): c is HTMLElement => c instanceof HTMLElement && c.tagName.toLowerCase() === "li",
          );
          return items[remaining] ?? null;
        }
        return child instanceof HTMLElement ? child : null;
      }
      remaining -= span;
    }
  }
  return null;
}

function blocksInTopChild(el: Element): number {
  const tag = el.tagName.toLowerCase();
  if (LIST_TAGS.has(tag)) {
    return Array.from(el.children).filter(
      (c) => c.tagName.toLowerCase() === "li",
    ).length;
  }
  return 1;
}

function findBlockElement(
  node: Node,
  hosts: readonly HTMLElement[],
): { blockEl: HTMLElement | null; blockIndex: number } {
  // Walk up from node. Stop at either:
  //   - an element whose parent is a content host → top-level block
  //   - an <li> whose grand-parent is a host → list-item block
  let cur: Node | null = node;
  while (cur) {
    if (cur instanceof HTMLElement) {
      const tag = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent && hosts.includes(parent) && (BLOCK_TAGS.has(tag) || LIST_TAGS.has(tag) || tag === "table" || tag === "div")) {
        // Top-level (non-list) block.
        if (LIST_TAGS.has(tag)) {
          // Caret landed on the `<ul>` itself somehow — degenerate case.
          // Resolve to the first list-item index.
          return { blockEl: cur.children[0] instanceof HTMLElement ? cur.children[0] : null, blockIndex: indexOfElement(cur, hosts) };
        }
        return { blockEl: cur, blockIndex: indexOfElement(cur, hosts) };
      }
      if (tag === "li" && parent && parent.parentElement && hosts.includes(parent.parentElement)) {
        return { blockEl: cur, blockIndex: indexOfElement(cur, hosts) };
      }
    }
    cur = cur.parentNode;
  }
  return { blockEl: null, blockIndex: -1 };
}

function indexOfElement(target: Element, hosts: readonly HTMLElement[]): number {
  let index = 0;
  for (const host of hosts) {
    for (const child of Array.from(host.children)) {
      const tag = child.tagName.toLowerCase();
      if (LIST_TAGS.has(tag)) {
        const items = Array.from(child.children).filter(
          (c): c is HTMLElement => c instanceof HTMLElement && c.tagName.toLowerCase() === "li",
        );
        if (items.includes(target as HTMLElement)) return index + items.indexOf(target as HTMLElement);
        index += items.length;
        continue;
      }
      if (child === target) return index;
      index += 1;
    }
  }
  return -1;
}

function isInsideTable(blockEl: Element): boolean {
  return blockEl.tagName.toLowerCase() === "table";
}

// === atom counting ===

function isAtomElement(el: Element): boolean {
  return ATOM_TAGS.has(el.tagName.toLowerCase());
}

function isWrapperElement(el: Element): boolean {
  return WRAPPER_TAGS.has(el.tagName.toLowerCase());
}

/**
 * Walk `blockEl`'s subtree in document order until `(targetNode,
 * targetOffset)` is reached; return the number of atoms seen so far.
 */
function charOffsetToPoint(
  blockEl: Element,
  targetNode: Node,
  targetOffset: number,
): number {
  let count = 0;
  let found = false;

  const visit = (node: Node): void => {
    if (found) return;
    if (node === targetNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node as Text;
        count += Math.min(Math.max(0, targetOffset), text.length);
      } else if (node instanceof Element) {
        const children = Array.from(node.childNodes);
        const clamped = Math.max(0, Math.min(targetOffset, children.length));
        for (let i = 0; i < clamped; i++) {
          const c = children[i];
          if (c) visit(c);
          if (found) return;
        }
      }
      found = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      count += (node as Text).length;
      return;
    }
    if (node instanceof Element) {
      if (isAtomElement(node)) {
        count += 1;
        return;
      }
      // Either a wrapper or an otherwise-transparent element (e.g. a
      // stray `<div>` from paste). In either case, recurse.
      if (isWrapperElement(node) || node.tagName.toLowerCase() === "div") {
        for (const c of Array.from(node.childNodes)) {
          visit(c);
          if (found) return;
        }
      } else {
        // Unknown element — recurse and hope for the best.
        for (const c of Array.from(node.childNodes)) {
          visit(c);
          if (found) return;
        }
      }
    }
  };

  // Kick off the walk from blockEl's children (we don't count blockEl itself).
  if (blockEl === targetNode) {
    // Caret directly at the block level — same handling as the element
    // branch inside visit().
    const children = Array.from(blockEl.childNodes);
    const clamped = Math.max(0, Math.min(targetOffset, children.length));
    for (let i = 0; i < clamped; i++) {
      const c = children[i];
      if (c) visit(c);
    }
    return count;
  }
  for (const c of Array.from(blockEl.childNodes)) {
    visit(c);
    if (found) return count;
  }
  return count;
}

/**
 * Reverse of `charOffsetToPoint`: find a DOM `(node, offset)` tuple
 * that corresponds to `targetOffset` characters into `blockEl`.
 */
function findPointAtOffset(
  blockEl: Element,
  targetOffset: number,
): { node: Node; offset: number } {
  let count = 0;
  let result: { node: Node; offset: number } | null = null;

  const visit = (node: Node): void => {
    if (result) return;

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      if (targetOffset <= count + text.length) {
        result = { node, offset: Math.max(0, targetOffset - count) };
        return;
      }
      count += text.length;
      return;
    }

    if (node instanceof Element) {
      if (isAtomElement(node)) {
        // The caret sits at the edge of this atom.
        const parent = node.parentNode;
        if (!parent) return;
        const idx = Array.from(parent.childNodes).indexOf(node);
        if (targetOffset === count) {
          result = { node: parent, offset: idx };
          return;
        }
        if (targetOffset === count + 1) {
          result = { node: parent, offset: idx + 1 };
          return;
        }
        count += 1;
        return;
      }
      for (const c of Array.from(node.childNodes)) {
        visit(c);
        if (result) return;
      }
    }
  };

  for (const c of Array.from(blockEl.childNodes)) {
    visit(c);
    if (result) return result;
  }

  // Past the end: place caret at the block's tail.
  return { node: blockEl, offset: blockEl.childNodes.length };
}
