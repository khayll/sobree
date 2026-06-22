import type {
  Block,
  NamedStyle,
  NumberingDefinition,
  Paragraph,
  ParagraphProperties,
  SectionProperties,
} from "../../../doc/types";
import { appendInlineRuns } from "./inline";
import { renderInlineFrameBlock } from "./inlineFrame";
import { applyListItemLevel, createListContainer, paragraphListInfo } from "./lists";
import { computeOutlineNumbers } from "./outlineNumbering";
import { renderParagraph } from "./paragraph";
import { applyParagraphProps } from "./properties";
import {
  collapseSectionTrailerEmpty,
  evictTrailingEmptyParagraphs,
  openColumnContainerIfNeeded,
} from "./sectionFlow";
import { renderTable } from "./table";

/**
 * Render a `Block[]` stream into `host`, grouping consecutive paragraphs
 * that share a `numId` into a single `<ul>`/`<ol>` so the browser renders
 * proper list markers.
 *
 * `numbering` maps `numId` → definition so we can decide ordered vs
 * bulleted. Unknown numIds fall back to `<ul>`.
 *
 * `rawParts` is threaded to image rendering so `<img src>` can be
 * populated from embedded bytes via a blob URL.
 */
export function renderBlocks(
  blocks: readonly Block[],
  host: HTMLElement,
  numbering: readonly NumberingDefinition[],
  styles: readonly NamedStyle[] = [],
  rawParts: Record<string, Uint8Array> = {},
  blockIds?: readonly string[],
  sections: readonly SectionProperties[] = [],
  /** Body block indices that carry an anchored frame. Such a block counts
   *  as a valid target for a deferred page break even when its body flow is
   *  empty — a float-only brochure panel page is still a page. */
  frameAnchoredIndices: ReadonlySet<number> = new Set(),
): void {
  // Outline numbers ("1", "1.1", …) for headings whose style links a
  // numbering definition — computed in one document-order pass, stamped as
  // a `data-outline-number` marker below.
  const outlineNumbers = computeOutlineNumbers(blocks, styles, numbering);
  let currentList: { el: HTMLElement; numId: number } | null = null;
  /**
   * Section index for the block currently being rendered. Starts at 0
   * (the first section), bumps every time we step over a `SectionBreak`.
   * Stamped onto each rendered element as `data-section-index` so the
   * paper stack can apply per-section settings (vAlign, etc.) page-by-page
   * without re-walking the AST.
   */
  let sectionIndex = 0;
  /**
   * If the current section has `columns.count > 1` we wrap its blocks in
   * a flat `<div class="sobree-cols">` stamped with the column geometry;
   * PaperStack's `flowColumnSections` pass restructures it into per-page
   * column tracks after layout. `appendTarget` becomes that wrapper; on a
   * section change we close it (revert to `host`) and re-evaluate for the
   * new section.
   */
  let appendTarget: HTMLElement = openColumnContainerIfNeeded(host, sections[0], 0);

  // Word's `<w:lastRenderedPageBreak/>` hints almost always land on
  // an EMPTY paragraph that the source author kept as a "end of
  // section" marker. Honoring the break literally creates a page
  // boundary BEFORE the empty paragraph — wasting the previous page
  // and putting the empty paragraph alone at the top of the next.
  // We DEFER the break: when a paragraph carrying `pageBreakBefore`
  // is empty, suppress its attribute and stash the break to be
  // applied to the next NON-EMPTY block. This produces the same
  // visual page boundary (break still happens before real content)
  // but the previous page packs whatever could fit, killing the
  // 11-of-26 wasteful-pages problem on complex-multipage.docx.
  let pendingPageBreak = false;
  const isVisuallyEmptyBlock = (b: Block): boolean => {
    if (b.kind === "section_break") return false;
    if (b.kind === "table") return false;
    if (b.kind !== "paragraph") return false;
    for (const r of b.runs) {
      if (r.kind === "text" && r.text.trim().length > 0) return false;
      if (r.kind === "drawing") return false;
      if (r.kind === "tab") return false;
      if (r.kind === "field") return false;
      if (r.kind === "hyperlink") return false;
      if (r.kind === "footnoteRef") return false;
    }
    return true;
  };

  const paragraphHasPageBreakRun = (b: Block): boolean =>
    b.kind === "paragraph" && b.runs.some((r) => r.kind === "break" && r.type === "page");

  const flushList = () => {
    currentList = null;
  };

  for (let i = 0; i < blocks.length; i++) {
    let block = blocks[i];
    if (!block) continue;
    const id = blockIds?.[i];

    // Page-break deferral: an empty paragraph whose break (a
    // `pageBreakBefore` property OR a `<w:br type="page">` run) would
    // otherwise land BEFORE it — wasting the previous page and pushing the
    // empty paragraph to the top of the next. Suppress it and re-apply to
    // the next block that has real content OR an anchored frame. The frame
    // check is load-bearing for float-only pages (a brochure panel page is
    // empty in body flow but is still a page); without it the deferred break
    // would never find a target and the document would collapse to one page.
    // (Clone, never mutate the source AST.)
    let triggeredHere = false;
    if (block.kind === "paragraph" && isVisuallyEmptyBlock(block)) {
      if (block.properties.pageBreakBefore || paragraphHasPageBreakRun(block)) {
        pendingPageBreak = true;
        triggeredHere = true;
        block = {
          ...block,
          properties: { ...block.properties, pageBreakBefore: false },
          runs: block.runs.filter((r) => !(r.kind === "break" && r.type === "page")),
        };
      }
    }
    if (
      pendingPageBreak &&
      !triggeredHere &&
      (!isVisuallyEmptyBlock(block) || frameAnchoredIndices.has(i))
    ) {
      if (block.kind === "paragraph") {
        block = { ...block, properties: { ...block.properties, pageBreakBefore: true } };
      }
      pendingPageBreak = false;
    }

    const listInfo = paragraphListInfo(block, numbering);
    if (listInfo) {
      if (!currentList || currentList.numId !== listInfo.numId) {
        const listEl = createListContainer(listInfo, sectionIndex);
        appendTarget.appendChild(listEl);
        currentList = { el: listEl, numId: listInfo.numId };
      }
      const li = document.createElement("li");
      if (id) li.dataset.blockId = id;
      li.dataset.sectionIndex = String(sectionIndex);
      li.dataset.blockIndex = String(i);
      applyParagraphProps(li, (block as Paragraph).properties, styles);
      applyListItemLevel(li, block, numbering);
      stampBlockRevision(li, (block as Paragraph).properties);
      appendInlineRuns(li, (block as Paragraph).runs, rawParts, styles);
      currentList.el.appendChild(li);
      continue;
    }
    flushList();

    // SectionBreak rendering needs the upcoming section's `type` to
    // decide whether it's a forced page break ("nextPage" / default)
    // or a flow-through ("continuous"). Pulled here so renderBlock
    // stays section-array-agnostic.
    const nextSectionForBreak =
      block.kind === "section_break" ? sections[block.toSectionIndex] : undefined;
    const rendered = renderBlock(block, numbering, styles, rawParts, nextSectionForBreak);
    if (rendered) {
      if (id) rendered.dataset.blockId = id;
      rendered.dataset.sectionIndex = String(sectionIndex);
      rendered.dataset.blockIndex = String(i);
      if (block.kind === "paragraph") {
        stampBlockRevision(rendered, block.properties);
        const outline = outlineNumbers.get(i);
        if (outline) rendered.dataset.outlineNumber = outline;
      }
      // Section breaks always go to `host`, never into the current
      // column container. If a `<w:sectPr>` ends a 2-column section,
      // the break is the boundary AFTER the section — putting it
      // inside the column container makes it a balanced-flow item
      // that throws off Word's intended pairing (e.g. jellap.docx's
      // ANYA section gets 4|4 instead of 3|3 because the section
      // break counts as the 8th item).
      if (block.kind === "section_break") {
        // Evict the prior column section's trailing empties to `host`
        // BEFORE the break, in document order, so the section-boundary
        // empty ends up immediately before the break — where
        // `collapseSectionTrailerEmpty` (below) can collapse it. Doing
        // this after appending the break would leave the empties after
        // it and defeat the collapse (the break wouldn't be last child).
        evictTrailingEmptyParagraphs(appendTarget, host);
        host.appendChild(rendered);
      } else {
        appendTarget.appendChild(rendered);
      }
    }
    if (block.kind === "section_break") {
      // Trailing empties were already evicted (in document order) to
      // `host` just before the break was appended — see the section_break
      // branch above. Word's column balancer doesn't count trailing
      // empties (jellap.docx's ANYA section balances 3|3, not 4|3), and
      // evicting before the break keeps the section-boundary empty
      // adjacent to it for the collapse below.
      //
      // Collapse the visual height of the empty paragraph that
      // immediately precedes this section break in `host`. Word stores
      // sectPrs INSIDE a paragraph's pPr; that paragraph is often an
      // empty placeholder whose only job is to carry the sectPr. Word
      // treats it as part of the section boundary and renders ~no
      // visible whitespace — but our render shows it at full
      // double-spaced 9pt = ~28px, creating an unsightly gap right
      // before each section change (jellap.docx's ANYA / APA headers
      // gain ~28px of post-heading whitespace from this).
      collapseSectionTrailerEmpty(host);
      // Section index ticks AFTER rendering the break itself — the break
      // belongs to the section it ends, not to the next one.
      sectionIndex += 1;
      // Close any open column container and re-evaluate for the new section.
      appendTarget = openColumnContainerIfNeeded(host, sections[sectionIndex], sectionIndex);
    }
  }
  // After the walk, evict trailing empties from whatever the final
  // appendTarget was (if it's a column container).
  evictTrailingEmptyParagraphs(appendTarget, host);
}

function renderBlock(
  block: Block,
  numbering: readonly NumberingDefinition[],
  styles: readonly NamedStyle[],
  rawParts: Record<string, Uint8Array>,
  nextSection?: SectionProperties,
): HTMLElement | null {
  if (block.kind === "paragraph") return renderParagraph(block, styles, rawParts);
  if (block.kind === "table") return renderTable(block, renderBlocks, numbering, styles, rawParts);
  if (block.kind === "section_break") return renderSectionBreak(nextSection);
  if (block.kind === "inline_frame") {
    return renderInlineFrameBlock(block, numbering, styles, rawParts, renderBlocks);
  }
  return null;
}

/**
 * Render a `SectionBreak` as a visible rule. Whether it carries
 * `data-page-break` depends on the upcoming section's `type`:
 *
 *   - "continuous" — render the rule but DO NOT mark it as a page
 *     break. The paginator flows past it; the section change still
 *     takes effect for vAlign, columns, etc. on the new section's
 *     blocks.
 *   - "nextPage" / "evenPage" / "oddPage" / undefined — forced page
 *     break. (We don't yet distinguish even / odd from nextPage.)
 *
 * The rule is `contentEditable=false` so caret traffic skips it.
 */
function renderSectionBreak(nextSection?: SectionProperties): HTMLElement {
  const el = document.createElement("div");
  el.className = "sobree-section-break";
  const isContinuous = nextSection?.type === "continuous";
  if (!isContinuous) {
    el.setAttribute("data-page-break", "");
  } else {
    el.classList.add("sobree-section-break--continuous");
  }
  // Set both the IDL property AND the HTML attribute — the IDL drives
  // caret behaviour, the attribute is what querying code (and jsdom in
  // tests) reads; jsdom doesn't reflect the IDL property to the attribute.
  el.contentEditable = "false";
  el.setAttribute("contenteditable", "false");
  el.setAttribute("role", "separator");
  el.setAttribute("aria-orientation", "horizontal");
  const label = isContinuous ? "Section break — continuous" : "Section break — next page";
  el.setAttribute("aria-label", label);
  const display = isContinuous ? "Section break · continuous" : "Section break · next page";
  el.innerHTML = `<span class="sobree-section-break__label" aria-hidden="true">${display}</span>`;
  return el;
}

/**
 * Stamp `data-block-revision="ins"|"del"` and `data-block-revision-author`
 * on a paragraph element whose properties carry a tracked-change marker
 * on the paragraph mark itself. The review plugin uses these to colour
 * the trailing paragraph-mark glyph (the "¶" the user types Enter to
 * produce). Core renders no visual itself — neutral by default; the
 * plugin layers the author colour.
 */
function stampBlockRevision(el: HTMLElement, props: ParagraphProperties): void {
  const rev = props.revision;
  if (!rev) return;
  el.dataset.blockRevision = rev.type;
  if (rev.author !== undefined) {
    el.dataset.blockRevisionAuthor = rev.author;
  }
  if (rev.date !== undefined) {
    el.dataset.blockRevisionDate = rev.date;
  }
}
