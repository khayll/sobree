/**
 * Render a `Paragraph` block to a `<p>` / `<h1..6>` element: heading
 * tag selection, paragraph-property CSS (delegated to properties.ts),
 * dominant-run font cascade, leading column-break hoist, inline runs,
 * and single-tab "label \t value" right-spread.
 */

import type { NamedStyle, Paragraph } from "../../../doc/types";
import { headingLevelOf } from "../../../doc/walk";
import { resolveFontFace } from "./fontFallback";
import { appendInlineRuns } from "./inline";
import { type ContextualNeighbors, applyParagraphProps } from "./properties";

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
  const paraRunDefaults = applyParagraphProps(el, p.properties, styles, contextualNeighbors);
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
  // Tab-spread: a paragraph with exactly one tab between two text
  // groups renders as a flex row (via the `sobree-tab-spread` CSS
  // class) so the after-tab content right-aligns to the margin —
  // Word's right-tab-stop behaviour for header label/value lines.
  // The tab run itself is dropped; the two sides become labelled
  // spans the CSS pushes apart with `justify-content: space-between`.
  // Paragraphs that don't match fall through to the normal inline render.
  const split = splitForTabSpread(p);
  if (split) {
    el.classList.add("sobree-tab-spread");
    const before = document.createElement("span");
    before.className = "sobree-tab-spread__before";
    appendInlineRuns(before, split.before, rawParts, styles, paraRunDefaults);
    const after = document.createElement("span");
    after.className = "sobree-tab-spread__after";
    appendInlineRuns(after, split.after, rawParts, styles, paraRunDefaults);
    el.append(before, after);
  } else {
    appendInlineRuns(el, p.runs, rawParts, styles, paraRunDefaults);
  }
  return el;
}

/**
 * Detect the "label … <gap> … value" spread and split the runs into
 * before / after groups, dropping the gap runs.
 *
 * Word emits the gap of a right-tab-stop header line (e.g.
 * "YOUR NAME      GitHub: link") as a maximal run of pure-SPACE text
 * runs (`" "`), NOT as a `<w:tab/>` element — so the separator we look
 * for is the first consecutive group of space-only runs. A literal
 * tab CHARACTER inside a text run (`"\t"`) is treated as content, not
 * a separator (it stays in the before-side span), matching the
 * dotted-leader header lines where the `\t` precedes the gap space.
 *
 * Returns `null` for paragraphs without such a gap, or where either
 * side lacks real text — those render inline normally.
 */
function splitForTabSpread(
  p: Paragraph,
): { before: Paragraph["runs"]; after: Paragraph["runs"] } | null {
  // Only header label/value lines built on a right tab stop spread.
  // The signal is a declared custom tab stop (`<w:pPr><w:tabs>`):
  // Word fills the stop's gap with a run of spaces, which we collapse
  // into the flex space-between. Paragraphs WITHOUT a tab stop keep
  // their standalone space runs verbatim (a normal sentence can carry
  // an isolated `" "` run — splitting those would wrongly reflow body
  // text, as seen on lease-agreement / mit-template).
  if (!p.properties.tabStops || p.properties.tabStops.length === 0) return null;
  const isSpaceRun = (r: Paragraph["runs"][number]): boolean =>
    r.kind === "text" && /^ +$/.test(r.text);
  // Locate the FIRST maximal group of consecutive space-only runs.
  let sepStart = -1;
  let sepEnd = -1;
  for (let i = 0; i < p.runs.length; i++) {
    if (isSpaceRun(p.runs[i]!)) {
      if (sepStart === -1) sepStart = i;
      sepEnd = i;
    } else if (sepStart !== -1) {
      break;
    }
  }
  if (sepStart === -1) return null;
  const before = p.runs.slice(0, sepStart);
  const after = p.runs.slice(sepEnd + 1);
  const hasText = (runs: Paragraph["runs"]) =>
    runs.some((r) => r.kind === "text" && r.text.trim().length > 0);
  if (!hasText(before) || !hasText(after)) return null;
  return { before, after };
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
