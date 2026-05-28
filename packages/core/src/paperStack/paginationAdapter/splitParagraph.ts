import { nodeAtCharOffset } from "./paragraphLines";

/**
 * Split `el` into two sibling elements at the given character offset. The
 * original keeps [0, charOffset); a new element (same tag + attributes) is
 * inserted immediately after and receives [charOffset, end). Returns the
 * new (bottom) element.
 *
 * Uses `Range.extractContents()` to move the tail into a fragment; preserves
 * element boundaries within the `<p>` (e.g. `<strong>`, `<code>` are cloned
 * if the split falls mid-element).
 */
export function splitElementAtCharOffset(el: HTMLElement, charOffset: number): HTMLElement {
  const pos = nodeAtCharOffset(el, charOffset);
  if (!pos) return el;

  const range = document.createRange();
  range.setStart(pos.node, pos.offset);
  range.setEnd(el, el.childNodes.length);

  const fragment = range.extractContents();

  const clone = document.createElement(el.tagName.toLowerCase());
  for (const attr of Array.from(el.attributes)) {
    clone.setAttribute(attr.name, attr.value);
  }
  clone.appendChild(fragment);

  // Tag the new fragment so distributePages can detect it. Used to
  // suppress the list marker on continuation `<li>` fragments
  // (matches Word's behaviour: a paragraph that splits inside a
  // numbered list shows the number ONLY on the head fragment, the
  // continuation flows on the next page without a marker).
  clone.dataset.pagContinuation = "1";

  el.parentNode?.insertBefore(clone, el.nextSibling);
  return clone;
}

/**
 * Move a split offset backward to the nearest word boundary (whitespace) so
 * words are never cut in half. We don't have a proper line-breaking engine,
 * so keeping words intact is the rule.
 *
 * Returns 0 if no whitespace is found before `offset` (rare — long single
 * word); callers should skip splitting in that case and let the paragraph
 * overflow rather than break mid-word.
 */
export function snapToWordBoundary(el: HTMLElement, offset: number): number {
  const text = el.textContent ?? "";
  for (let i = Math.min(offset, text.length) - 1; i >= 0; i--) {
    if (/\s/.test(text[i] ?? "")) return i + 1;
  }
  return 0;
}
