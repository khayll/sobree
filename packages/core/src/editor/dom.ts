/**
 * DOM utilities for the editor — selection geometry, block-element
 * lookup, drag/drop image detection, image sizing. Browser-only
 * (no model state); kept apart from `editor/index.ts` so the editor
 * module stays about editing, not DOM plumbing.
 */

const BLOCK_ELEMENT_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "hr",
  "blockquote",
  "ul",
  "ol",
  "pre",
  "table",
  "div",
  "dl",
]);

/** Nearest ancestor (or self) that is a direct block child of a host. */
export function closestBlockElement(node: Node, hosts: HTMLElement[]): HTMLElement | null {
  let cur: Node | null = node;
  while (cur) {
    if (cur instanceof HTMLElement) {
      const parent = cur.parentElement;
      if (parent && hosts.includes(parent)) return cur;
      if (BLOCK_ELEMENT_TAGS.has(cur.tagName.toLowerCase()) && parent && hosts.includes(parent)) {
        return cur;
      }
    }
    cur = cur.parentNode;
  }
  return null;
}

/** The live DOM selection range, but only if both ends are inside a host. */
export function currentDomRangeInsideHosts(hosts: HTMLElement[]): Range | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!hosts.some((h) => h.contains(range.startContainer) && h.contains(range.endContainer))) {
    return null;
  }
  return range;
}

/** True when a drag/paste DataTransfer carries at least one image file. */
export function hasImageInDataTransfer(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  if (dt.types && Array.from(dt.types).includes("Files")) {
    for (const f of Array.from(dt.files ?? [])) {
      if (f.type.startsWith("image/")) return true;
    }
  }
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) return true;
  }
  return false;
}

interface CaretPositionish {
  offsetNode: Node;
  offset: number;
}

/** Cross-browser caret range at viewport (x, y) — drop-point resolution. */
export function caretRangeFromPoint(x: number, y: number): Range | null {
  const docAny = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => CaretPositionish | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (docAny.caretRangeFromPoint) return docAny.caretRangeFromPoint(x, y);
  const pos = docAny.caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const range = document.createRange();
  range.setStart(pos.offsetNode, pos.offset);
  range.collapse(true);
  return range;
}

/** Decode an image file's natural dimensions (falls back to 200×150). */
export function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 200;
      const h = img.naturalHeight || 150;
      URL.revokeObjectURL(url);
      resolve({ width: w, height: h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 200, height: 150 });
    };
    img.src = url;
  });
}

/** Replace an element with its children (lift contents up one level). */
export function unwrap(el: HTMLElement): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}
