/**
 * Section-flow helpers: managing column containers, trailing-empty
 * paragraphs, and section-break trailer collapse.
 *
 * These are the small DOM-shaping utilities `renderBlocks` calls
 * around section boundaries to match Word's column-balancing semantics
 * and visual collapsing of pre-break empty paragraphs.
 */

import { twipsToMm } from "./units";
import type { SectionProperties } from "../../../doc/types";

/**
 * If `section.columns.count > 1`, append a column container to `host`
 * and return it as the new append target. Otherwise return `host` —
 * single-column sections write directly to it.
 */
export function openColumnContainerIfNeeded(
  host: HTMLElement,
  section: SectionProperties | undefined,
): HTMLElement {
  const cols = section?.columns;
  if (!cols || cols.count <= 1) return host;
  const wrapper = document.createElement("div");
  wrapper.className = "sobree-section-cols";
  wrapper.style.columnCount = String(cols.count);
  if (cols.spaceTwips !== undefined) {
    wrapper.style.columnGap = `${twipsToMm(cols.spaceTwips)}mm`;
  }
  host.appendChild(wrapper);
  return wrapper;
}

/**
 * If `container` is a column-flow container, move any trailing
 * visually-empty paragraphs out of it and append them to `host`. Keeps
 * Word's column balancing semantics: empties between content count,
 * trailing empties do not.
 */
export function evictTrailingEmptyParagraphs(
  container: HTMLElement,
  host: HTMLElement,
): void {
  if (!container.classList.contains("sobree-section-cols")) return;
  while (container.lastElementChild) {
    const last = container.lastElementChild as HTMLElement;
    if (!isVisuallyEmptyParagraph(last)) break;
    container.removeChild(last);
    host.appendChild(last);
  }
}

/**
 * Visually collapse the empty paragraph immediately preceding the
 * just-appended section_break. The paragraph stays in the DOM (and the
 * AST) so round-trip and caret behaviour stay intact; CSS just zeros
 * its height. Pulls back from the last element (which is the section
 * break itself) by one position and checks if it's a visually-empty
 * paragraph (no text, no images).
 */
export function collapseSectionTrailerEmpty(host: HTMLElement): void {
  // The section_break was the LAST child appended. Step back one.
  const sectBreak = host.lastElementChild;
  if (!sectBreak || !sectBreak.classList.contains("sobree-section-break")) return;
  const trailer = sectBreak.previousElementSibling as HTMLElement | null;
  if (!trailer) return;
  if (trailer.tagName !== "P" && trailer.tagName !== "LI") return;
  if ((trailer.textContent ?? "").trim().length > 0) return;
  if (trailer.querySelector("img, svg, table")) return;
  trailer.classList.add("sobree-section-trailer-empty");
}

function isVisuallyEmptyParagraph(el: HTMLElement): boolean {
  if (el.tagName !== "P" && el.tagName !== "LI") return false;
  if ((el.textContent ?? "").trim().length > 0) return false;
  if (el.querySelector("img, svg, table") !== null) return false;
  return true;
}
