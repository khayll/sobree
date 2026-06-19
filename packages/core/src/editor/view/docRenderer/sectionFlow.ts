/**
 * Section-flow helpers: managing column containers, trailing-empty
 * paragraphs, and section-break trailer collapse.
 *
 * These are the small DOM-shaping utilities `renderBlocks` calls
 * around section boundaries to match Word's column-balancing semantics
 * and visual collapsing of pre-break empty paragraphs.
 */

import type { SectionProperties } from "../../../doc/types";
import { twipsToMm } from "./units";

/**
 * If `section.columns.count > 1`, append a multi-column container to
 * `host` and return it as the new append target. Otherwise return `host`
 * — single-column sections write directly to it.
 *
 * The container is flat here (blocks append straight in); after layout,
 * PaperStack's `flowColumnSections` pass restructures it into per-page
 * column tracks (and snakes content across pages). Both equal- and
 * unequal-width sections share the `.sobree-cols` class and stamp their
 * geometry onto the wrapper:
 *   - `data-col-count`     — column count (every multi-column wrapper)
 *   - `data-pag-cid`       — stable section id, so the flow pass can
 *                            re-consolidate a section's per-page wrappers
 *   - unequal: `data-col-widths-mm` + `data-col-gaps-mm` (explicit)
 *   - equal:   `data-col-gap-mm` (tracks sized by the flow pass)
 */
export function openColumnContainerIfNeeded(
  host: HTMLElement,
  section: SectionProperties | undefined,
  sectionIndex = 0,
): HTMLElement {
  const cols = section?.columns;
  if (!cols || cols.count <= 1) return host;

  const wrapper = document.createElement("div");
  wrapper.dataset.colCount = String(cols.count);
  wrapper.dataset.pagCid = `cols-${sectionIndex}`;

  if (cols.equalWidth === false && cols.columns && cols.columns.length === cols.count) {
    // Unequal columns: explicit per-column widths + per-gap spacing.
    wrapper.className = "sobree-cols sobree-cols-unequal";
    wrapper.dataset.colWidthsMm = cols.columns.map((c) => twipsToMm(c.widthTwips)).join(",");
    wrapper.dataset.colGapsMm = cols.columns
      .slice(0, -1)
      .map((c) => twipsToMm(c.spaceTwips ?? cols.spaceTwips ?? 0))
      .join(",");
  } else {
    // Equal columns: one shared gap; the flow pass sizes the tracks.
    wrapper.className = "sobree-cols sobree-section-cols";
    wrapper.dataset.colGapMm = String(twipsToMm(cols.spaceTwips ?? 0));
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
export function evictTrailingEmptyParagraphs(container: HTMLElement, host: HTMLElement): void {
  if (!container.classList.contains("sobree-section-cols")) return;
  // Collect the trailing empties first, then re-append in DOCUMENT order.
  // Popping `lastElementChild` and appending as we go would reverse them —
  // which matters because the caller relies on the LAST trailing empty
  // (the section-boundary paragraph) ending up immediately before the
  // section break, where `collapseSectionTrailerEmpty` can collapse it.
  const trailing: HTMLElement[] = [];
  while (container.lastElementChild) {
    const last = container.lastElementChild as HTMLElement;
    if (!isVisuallyEmptyParagraph(last)) break;
    container.removeChild(last);
    trailing.unshift(last);
  }
  for (const p of trailing) host.appendChild(p);
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
  // The collapse must zero the paragraph's WHOLE vertical footprint, not
  // just its box. `applyParagraphProps` already wrote an inline
  // `margin-top/bottom` from the paragraph's `spacing.before/afterTwips`
  // (jellap's boundary empty carries `afterTwips=240` → 4mm), and an
  // inline value beats the class's `margin: 0`. Neutralise it inline here
  // — we run after the renderer, so this is the last write and wins —
  // otherwise the boundary paragraph still injects its spacing-after gap.
  trailer.style.marginTop = "0";
  trailer.style.marginBottom = "0";
}

function isVisuallyEmptyParagraph(el: HTMLElement): boolean {
  if (el.tagName !== "P" && el.tagName !== "LI") return false;
  if ((el.textContent ?? "").trim().length > 0) return false;
  if (el.querySelector("img, svg, table") !== null) return false;
  return true;
}
