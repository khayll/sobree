/**
 * Tab-stop layout semantics — the single module that decides how a
 * paragraph's declared tab stops (`<w:tabs>`, direct pPr or style
 * cascade) and its `\t` runs map onto a layout plan. CSS has no native
 * tab-stop model, so each supported shape gets an explicit plan the
 * paragraph renderer assembles into DOM:
 *
 *   - {@link planRightTailTab} — "entry text `\t` page number" with a
 *     trailing RIGHT-aligned stop (TOC / index / list-of-figures
 *     lines): the post-tab tail right-aligns at the stop, the gap
 *     optionally filled with the stop's `w:leader` glyph.
 *   - {@link splitForTabSpread} — header label/value lines where Word
 *     emits the gap as literal space runs rather than a `<w:tab/>`.
 *
 * Paragraphs matching neither fall back to the `tab-size`
 * approximation in `properties.ts`.
 */

import type { InlineRun, Paragraph, ParagraphProperties, TextRun } from "../../../doc/types";
import { twipsToMm } from "./units";

/**
 * `w:leader` → fill glyph. Real text glyphs (not CSS borders /
 * gradients) so the fill sits on the text baseline and scales with the
 * paragraph font, matching how Word draws leaders. `none` (and unknown
 * values) yield no fill.
 */
const LEADER_FILL_CHAR: Record<string, string> = {
  dot: ".",
  hyphen: "-",
  underscore: "_",
  heavy: "_",
  middleDot: "·",
};

/**
 * Leader-span fill capacity, in glyphs. The span is `flex: 1 1 0` with
 * `overflow: hidden`, so this only needs to be "enough to span the
 * widest text column at the smallest glyph" — surplus glyphs are
 * clipped, never measured. Not a geometry value.
 */
const LEADER_FILL_CAPACITY = 512;

/** Layout plan for a trailing right-tab-stop paragraph. */
export interface RightTailPlan {
  before: InlineRun[];
  after: InlineRun[];
  /** The document characters the spread's flex layout replaces (the tab,
   *  or the space run for the legacy spread). The renderer keeps them in
   *  a zero-width span so the paragraph's TEXT is not corrupted by the
   *  layout: copy/paste yields "label\tvalue" (not "labelvalue"), the
   *  DOM→AST serializer round-trips the separator, and text-level
   *  comparisons (the corpus matcher) still see the source characters. */
  separatorText: string;
  /** Fill glyph string for the gap (already repeated to capacity);
   *  absent when the stop declares no usable `w:leader`. */
  leaderFill?: string;
  /** CSS `margin-right` for the tail: reserves the distance between
   *  the stop and the paragraph's right edge when the stop sits short
   *  of it (`w:pos` < text-column width). Derived from `w:pos` and the
   *  paragraph's left indent — no assumption about the column width,
   *  which only CSS knows (`100%`). */
  tailMarginRight: string;
  /** CSS `margin-left` for the entry text, carrying the paragraph's
   *  first-line indent (`w:firstLine` / `w:hanging`). The paragraph
   *  becomes a flex container, and flex containers ignore
   *  `text-indent` — without this, indented TOC sub-entries would
   *  lose their level offset. The spread renders one visual line, so
   *  the first-line indent IS the entry's indent. */
  beforeMarginLeft?: string;
}

/**
 * Detect the "entry text `\t` right-aligned tail" shape: the FARTHEST
 * declared stop is right-aligned and the paragraph contains exactly one
 * tab character between content. Word advances that single tab to the
 * last stop, right-aligning whatever follows — the TOC line layout.
 *
 * Bails (→ `tab-size` fallback) on: no stops / farthest stop not
 * right-aligned, zero or 2+ tabs (each would need its own stop
 * position), a tab inside a hyperlink (can't split a link's children
 * across the gap), or an empty tail.
 */
export function planRightTailTab(
  p: Paragraph,
  effective: ParagraphProperties,
): RightTailPlan | null {
  // `clear` stops delete an inherited stop; they never host a tab.
  const stops = (effective.tabStops ?? []).filter((s) => s.alignment !== "clear");
  if (stops.length === 0) return null;
  const last = stops.reduce((a, b) => (b.positionTwips >= a.positionTwips ? b : a));
  if (last.alignment !== "right") return null;

  // Locate the single tab character among top-level text runs.
  let tabRun = -1;
  let tabChar = -1;
  for (let i = 0; i < p.runs.length; i++) {
    const r = p.runs[i]!;
    if (r.kind === "hyperlink" && hyperlinkContainsTab(r.children)) return null;
    if (r.kind !== "text") continue;
    let idx = r.text.indexOf("\t");
    while (idx !== -1) {
      if (tabRun !== -1) return null; // second tab → mixed stops, bail
      tabRun = i;
      tabChar = idx;
      idx = r.text.indexOf("\t", idx + 1);
    }
  }
  if (tabRun === -1) return null;

  const host = p.runs[tabRun] as TextRun;
  const pre = host.text.slice(0, tabChar);
  const post = host.text.slice(tabChar + 1);
  const before: InlineRun[] = [...p.runs.slice(0, tabRun)];
  if (pre) before.push({ ...host, text: pre });
  const after: InlineRun[] = [];
  if (post) after.push({ ...host, text: post });
  after.push(...p.runs.slice(tabRun + 1));
  if (!hasVisibleContent(after)) return null;

  // `w:pos` is measured from the text margin; the paragraph's content
  // box is already shifted right by its left indent, so the tail's
  // distance-from-right is (100% of the box) minus (pos − left indent).
  // For the common TOC case (stop at the column edge) this resolves to
  // ~0; a stop beyond the edge goes slightly negative and the tail
  // overflows — the same thing Word does.
  const offsetTwips = last.positionTwips - (effective.indent?.leftTwips ?? 0);
  if (offsetTwips <= 0) return null;
  const tailMarginRight = `calc(100% - ${twipsToMm(offsetTwips)}mm)`;

  // Mirrors the text-indent mapping in `applyParagraphProps`
  // (firstLine positive, hanging negative — mutually exclusive).
  const firstLine = effective.indent?.firstLineTwips;
  const hanging = effective.indent?.hangingTwips;
  const beforeMarginLeft =
    firstLine !== undefined
      ? `${twipsToMm(firstLine)}mm`
      : hanging !== undefined
        ? `-${twipsToMm(hanging)}mm`
        : undefined;

  const leaderChar = last.leader ? LEADER_FILL_CHAR[last.leader] : undefined;
  return {
    before,
    after,
    separatorText: "\t",
    ...(leaderChar ? { leaderFill: leaderChar.repeat(LEADER_FILL_CAPACITY) } : {}),
    tailMarginRight,
    ...(beforeMarginLeft ? { beforeMarginLeft } : {}),
  };
}

function hyperlinkContainsTab(children: readonly InlineRun[]): boolean {
  return children.some((r) => r.kind === "text" && r.text.includes("\t"));
}

function hasVisibleContent(runs: readonly InlineRun[]): boolean {
  return runs.some((r) => {
    if (r.kind === "text") return r.text.trim().length > 0;
    if (r.kind === "hyperlink") return hasVisibleContent(r.children);
    return r.kind === "field" || r.kind === "drawing";
  });
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
export function splitForTabSpread(
  p: Paragraph,
): { before: Paragraph["runs"]; after: Paragraph["runs"]; separatorText: string } | null {
  // Only header label/value lines built on a right tab stop spread.
  // The signal is a declared custom tab stop (`<w:pPr><w:tabs>`):
  // Word fills the stop's gap with a run of spaces, which we collapse
  // into the flex space-between. Paragraphs WITHOUT a tab stop keep
  // their standalone space runs verbatim (a normal sentence can carry
  // an isolated `" "` run — splitting those would wrongly reflow body
  // text, as seen on lease-agreement / mit-template). DIRECT stops
  // only: this space-run heuristic predates style-cascaded stops, and
  // widening its trigger would re-flow body text in styled documents.
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
  const separatorText = p.runs
    .slice(sepStart, sepEnd + 1)
    .map((r) => (r.kind === "text" ? r.text : ""))
    .join("");
  return { before, after, separatorText };
}
