/**
 * Namespace-aware XML traversal helpers shared by every DrawingML reader.
 * Pure plumbing — no DrawingML semantics live here, only the
 * `namespaceURI`/`localName` matching the DOM's `getElementsByTagName`
 * can't do directly. Numeric/EMU attribute reads live in `extents.ts`.
 */

/** First DIRECT child of `parent` in `ns` with `localName === local`. */
export function firstChildNS(parent: Element, ns: string, local: string): Element | null {
  for (const child of Array.from(parent.children)) {
    if (child.namespaceURI === ns && child.localName === local) return child;
  }
  return null;
}

/** First DESCENDANT (any depth) of `root` in `ns` with `localName === local`. */
export function firstNS(root: Element, ns: string, local: string): Element | null {
  const found = root.getElementsByTagNameNS(ns, local)[0];
  return found ?? null;
}

/** All DIRECT children of `parent` in `ns` with `localName === local`. */
export function directChildrenNS(parent: Element, ns: string, local: string): Element[] {
  const out: Element[] = [];
  for (const child of Array.from(parent.children)) {
    if (child.namespaceURI === ns && child.localName === local) out.push(child);
  }
  return out;
}

/** Nearest ANCESTOR of `start` in `ns` with `localName === local`. */
export function findAncestor(start: Element, ns: string, local: string): Element | null {
  let el: Element | null = start.parentElement;
  while (el) {
    if (el.namespaceURI === ns && el.localName === local) return el;
    el = el.parentElement;
  }
  return null;
}
