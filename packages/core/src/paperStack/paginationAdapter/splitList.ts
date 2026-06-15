/**
 * Split an `<ol>` / `<ul>` into two sibling list elements at the given
 * child index. The original keeps `<li>`s `[0, liIndex)`; a new sibling
 * (same tag + cloned attributes) is inserted immediately after and
 * receives `<li>`s `[liIndex, end)`. Returns the new (tail) element.
 *
 * Why this exists: paragraphs can split mid-character via
 * `splitElementAtCharOffset`, but lists need to split at `<li>`
 * boundaries — both because the LI is the smallest paginable unit AND
 * because mid-LI splits would require duplicating the marker (number /
 * bullet) which is browser-rendered.
 *
 * For ordered lists, the tail clone gets a `start` attribute so the
 * second fragment continues numbering from where the first left off.
 * `start` is computed from the head's surviving `<li>` count plus the
 * head's own `start` attribute (defaults to 1) — handles already-split
 * fragments correctly.
 */
export function splitListAtChild(el: HTMLElement, liIndex: number): HTMLElement {
  const lis = Array.from(el.children).filter((c) => c.tagName === "LI") as HTMLElement[];
  if (liIndex <= 0 || liIndex >= lis.length) return el;

  const clone = document.createElement(el.tagName.toLowerCase());
  for (const attr of Array.from(el.attributes)) {
    clone.setAttribute(attr.name, attr.value);
  }

  // For <ol>, set `start` on the clone so numbering continues across
  // the split. The head keeps its own start (or default 1).
  if (el.tagName === "OL") {
    const headStart = Number.parseInt(el.getAttribute("start") ?? "1", 10);
    const tailStart = (Number.isFinite(headStart) ? headStart : 1) + liIndex;
    clone.setAttribute("start", String(tailStart));
  }

  // Move tail <li> children into the clone.
  for (let i = liIndex; i < lis.length; i++) {
    clone.appendChild(lis[i]!);
  }

  el.parentNode?.insertBefore(clone, el.nextSibling);
  return clone;
}
