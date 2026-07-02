/**
 * Render a `Paragraph` block to a `<p>` / `<h1..6>` element: heading
 * tag selection, paragraph-property CSS (delegated to properties.ts),
 * dominant-run font cascade, leading column-break hoist, inline runs,
 * and tab-stop layouts (delegated to tabLayout.ts).
 */

import type { NamedStyle, Paragraph } from "../../../doc/types";
import { headingLevelOf } from "../../../doc/walk";
import { resolveFontFace } from "./fontFallback";
import { appendInlineRuns } from "./inline";
import { type ContextualNeighbors, applyParagraphProps } from "./properties";
import { planRightTailTab, splitForTabSpread } from "./tabLayout";

export function renderParagraph(
  p: Paragraph,
  styles: readonly NamedStyle[],
  rawParts: Record<string, Uint8Array>,
  contextualNeighbors?: ContextualNeighbors,
): HTMLElement {
  const level = headingLevelOf(p);
  // Empty heading paragraphs (no text, no image runs) demote to plain
  // `<p>` so they don't reserve the full Heading-font line-box. Word
  // / LO render empty headings as a thin gap; without the demotion,
  // Sobree's empty H1 takes ~33px (Heading font + margins) and creates
  // a glaring whitespace gap between e.g. an Experience heading and
  // its first bullet on google-modern.docx. The original heading
  // semantics never matter for an empty paragraph — there's no
  // outline entry to lose.
  const isEmpty = p.runs.length === 0 || p.runs.every((r) => (r.kind === "text" ? !r.text : false));
  const tag = level && !isEmpty ? `h${level}` : "p";
  const el = document.createElement(tag);
  const { runDefaults: paraRunDefaults, effective } = applyParagraphProps(
    el,
    p.properties,
    styles,
    contextualNeighbors,
  );
  // Cascade the dominant text run's font onto the paragraph itself when
  // the paragraph has no explicit font from style cascade. CSS unitless
  // line-height computes against the element's own font-size — if the
  // paragraph keeps the browser-default 16px while its runs use 9pt
  // text, every line box reserves 2.3 × 16 = 36.8px and the form-field
  // layout balloons (the jellap.docx case). Setting the paragraph's
  // font to the run's font keeps line-height honest: 2.3 × 9pt ≈ 24px.
  cascadeDominantRunFont(el, p);
  // Hoist a leading column-break run onto the paragraph element so CSS
  // columns honour it — `break-before: column` doesn't apply to
  // inline-rendered `<br>` / `<span>` markers. This is what makes
  // jellap.docx's form fields pair as rows (helye | ideje, etc.)
  // instead of running sequentially down both columns: the column
  // break advances to the next column.
  if (paragraphLeadsWithColumnBreak(p)) {
    el.style.breakBefore = "column";
    el.classList.add("sobree-column-break-before");
  }
  // Hoist a contained `<w:br w:type="page"/>` run onto the paragraph
  // element as `data-page-break-before` so the paginator forces a
  // break here. The paginator only inspects block-level elements'
  // attributes, so a page-break run rendered as an inline marker deep
  // inside the paragraph would otherwise be invisible to it. (This is
  // an approximation: the break is treated as "before this paragraph"
  // regardless of the run's position within it — fine for the common
  // case of an empty paragraph that exists solely to carry the break.)
  if (paragraphContainsPageBreak(p)) {
    el.setAttribute("data-page-break-before", "");
  }
  // Tab layouts (tabLayout.ts owns the semantics; this block only
  // assembles the DOM):
  //
  // 1. Right-tail: "entry text `\t` page number" against a trailing
  //    right-aligned stop (TOC lines). The tab character is consumed
  //    by the layout; the tail right-aligns at the stop and the gap is
  //    filled with the stop's leader glyphs. Without this, `tab-size`
  //    treats the right stop as a LEFT stop — the single tab eats the
  //    full line width and the page number wraps, doubling every TOC
  //    entry's height.
  // 2. Space-gap spread: header label/value lines where the gap is a
  //    run of literal spaces (no tab character to key on).
  //
  // The flex layout carries the GEOMETRY, but the separator characters
  // (tab / spaces) stay in the DOM inside a zero-width `__sep` span —
  // dropping them corrupted the paragraph's text: copy/paste yielded
  // "labelvalue", the DOM→AST serializer lost the tab, and the corpus
  // text-matcher unmatched every spread line (pentest-engineer 72→63
  // matched blocks).
  const rightTail = planRightTailTab(p, effective);
  const split = rightTail ?? splitForTabSpread(p);
  if (split) {
    el.classList.add("sobree-tab-spread");
    const before = document.createElement("span");
    before.className = "sobree-tab-spread__before";
    appendInlineRuns(before, split.before, rawParts, styles, paraRunDefaults);
    const sep = document.createElement("span");
    sep.className = "sobree-tab-spread__sep";
    sep.textContent = split.separatorText;
    const after = document.createElement("span");
    after.className = "sobree-tab-spread__after";
    appendInlineRuns(after, split.after, rawParts, styles, paraRunDefaults);
    if (rightTail) {
      after.style.marginRight = rightTail.tailMarginRight;
      if (rightTail.beforeMarginLeft) before.style.marginLeft = rightTail.beforeMarginLeft;
      if (rightTail.leaderFill) {
        // Synthetic view-only fill: non-editable (the serializer skips
        // contenteditable=false chrome) and hidden from the a11y tree.
        const leader = document.createElement("span");
        leader.className = "sobree-tab-spread__leader";
        leader.setAttribute("contenteditable", "false");
        leader.setAttribute("aria-hidden", "true");
        leader.textContent = rightTail.leaderFill;
        el.append(before, sep, leader, after);
        return el;
      }
    }
    el.append(before, sep, after);
  } else {
    appendInlineRuns(el, p.runs, rawParts, styles, paraRunDefaults);
  }
  return el;
}

/** True when any run in the paragraph is an explicit page break. */
function paragraphContainsPageBreak(p: Paragraph): boolean {
  for (const r of p.runs) {
    if (r.kind === "break" && r.type === "page") return true;
  }
  return false;
}

/**
 * True when the paragraph's first non-empty run is a column break.
 * Hoisted to `break-before: column` on the paragraph element.
 */
function paragraphLeadsWithColumnBreak(p: Paragraph): boolean {
  for (const r of p.runs) {
    // Skip empty text runs (whitespace-only) before the break.
    if (r.kind === "text" && !r.text.trim()) continue;
    if (r.kind === "break" && r.type === "column") return true;
    // Any other content first → not a leading column break.
    return false;
  }
  return false;
}

function cascadeDominantRunFont(el: HTMLElement, p: Paragraph): void {
  // Pick the font + size of the FIRST text run with an explicit font;
  // that's the paragraph's visual dominant. Used to set the paragraph
  // element's own font so unitless line-height computes correctly.
  let family: string | undefined;
  let sizePt: number | undefined;
  for (const r of p.runs) {
    if (r.kind !== "text") continue;
    if (!family && r.properties.fontFamily) family = r.properties.fontFamily;
    if (sizePt === undefined && r.properties.fontSizePt !== undefined) {
      sizePt = r.properties.fontSizePt;
    }
    if (family && sizePt !== undefined) break;
  }
  // Only set when applyParagraphProps didn't already resolve a font
  // from the style cascade — an explicit style font (e.g. Calibri on
  // the paragraph's pStyle) must win over the first run's font. The
  // dominant-run cascade is a FALLBACK for paragraphs whose style
  // chain leaves the font unset, purely to keep unitless line-height
  // honest. (Symmetric with the fontSize guard below.)
  if (family && !el.style.fontFamily) {
    const face = resolveFontFace(family);
    el.style.fontFamily = face.stack;
    if (face.weight !== undefined && !el.style.fontWeight) {
      el.style.fontWeight = String(face.weight);
    }
  }
  if (sizePt !== undefined && !el.style.fontSize) {
    el.style.fontSize = `${sizePt}pt`;
  }
}
