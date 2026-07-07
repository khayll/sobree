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

import type {
  HyperlinkRun,
  InlineRun,
  Paragraph,
  ParagraphProperties,
  TabStop,
  TextRun,
} from "../../../doc/types";
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
  /** CSS `width` for the tail span, in `ch`, sized to the tail's own
   *  character count. The tail is an atomic flex item (the page number)
   *  that must never be squeezed, but Chromium mis-computes its
   *  content-based (`auto` / `max-content`) main size as 0 next to the
   *  elastic leader, collapsing it so the leader dots bleed across the
   *  number. A DEFINITE, content-derived width sidesteps that intrinsic
   *  size entirely; `text-align: right` keeps the number pinned to the
   *  stop when it is narrower than the reserved `ch` box. */
  tailWidthCh?: number;
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

  // TOC / list-of-* lines wrap the whole "entry `\t` page number" in ONE
  // hyperlink (a TOC field's result is a single link), so the tail tab
  // is a link CHILD the top-level scan below can't reach — those lines
  // fell to the `tab-size` approximation, which overflowed the longer
  // entries onto a second line. Split the link around its tail tab
  // instead, so the page number right-aligns at the leader stop like Word.
  const linkTail = planHyperlinkRightTail(p, last, effective);
  if (linkTail) return linkTail;

  // Locate the tab characters among top-level text runs. ONE tab is
  // the TOC right-tail. SEVERAL CONSECUTIVE tabs (nothing but
  // whitespace between them) are Word's footer idiom — the walk
  // consumes one STOP per tab in position order, so "Feb \t \t text"
  // against [center@4680, right@9360] lands the tail on the SECOND
  // stop: the empty middle segment eats the center stop and the text
  // right-aligns at 9360, exactly Word/LO's single spread line.
  let tabRun = -1;
  let tabChar = -1;
  let lastTabRun = -1;
  let lastTabChar = -1;
  let tabCount = 0;
  for (let i = 0; i < p.runs.length; i++) {
    const r = p.runs[i]!;
    if (r.kind === "hyperlink" && hyperlinkContainsTab(r.children)) return null;
    if (r.kind !== "text") continue;
    let idx = r.text.indexOf("\t");
    while (idx !== -1) {
      if (tabRun === -1) {
        tabRun = i;
        tabChar = idx;
      }
      lastTabRun = i;
      lastTabChar = idx;
      tabCount++;
      idx = r.text.indexOf("\t", idx + 1);
    }
  }
  if (tabRun === -1) return null;

  // The tail's stop: for one tab, Word's TOC idiom targets the LAST
  // right stop (calibrated behaviour); for N tabs, the walk consumes
  // stops in order and the tail sits on the N-th.
  let tailStop = last;
  let separator = "\t";
  if (tabCount > 1) {
    const sorted = [...stops].sort((a, b) => a.positionTwips - b.positionTwips);
    const walked = sorted[tabCount - 1];
    if (!walked || walked.alignment !== "right") return null;
    tailStop = walked;
    // Everything between the FIRST and LAST tab must be whitespace-only
    // — a non-empty middle segment would need its own (center) layout,
    // which this planner doesn't model.
    let between = "";
    for (let i = tabRun; i <= lastTabRun; i++) {
      const r = p.runs[i]!;
      if (r.kind !== "text") return null;
      const from = i === tabRun ? tabChar + 1 : 0;
      const to = i === lastTabRun ? lastTabChar : r.text.length;
      between += r.text.slice(from, to);
    }
    if (between.replace(/[\t ]/g, "") !== "") return null;
    separator = `\t${between}\t`;
  }

  const host = p.runs[tabRun] as TextRun;
  const tailHost = p.runs[lastTabRun] as TextRun;
  const pre = host.text.slice(0, tabChar);
  const post = tailHost.text.slice(lastTabChar + 1);
  const before: InlineRun[] = [...p.runs.slice(0, tabRun)];
  if (pre) before.push({ ...host, text: pre });
  const after: InlineRun[] = [];
  if (post) after.push({ ...tailHost, text: post });
  after.push(...p.runs.slice(lastTabRun + 1));

  return buildRightTailPlan(before, after, separator, tailStop, effective);
}

/**
 * TOC / list-of-* entries are emitted as ONE hyperlink wrapping the whole
 * "[number] `\t` title `\t` page number" (a TOC field's result is a single
 * link). The top-level {@link planRightTailTab} scan can't split a tab
 * that lives inside a link's children, so long entries fell to the
 * `tab-size` fallback and wrapped onto a second line. Split the link
 * around its LAST tab — the one Word advances to the leader/right stop —
 * into a before-link (entry, keeping any earlier number/title tab) and an
 * after-link (page number), each retaining the href. The leader fills the
 * gap and the page number right-aligns on one line, matching Word.
 */
function planHyperlinkRightTail(
  p: Paragraph,
  rightStop: TabStop,
  effective: ParagraphProperties,
): RightTailPlan | null {
  // A top-level text tab belongs to the top-level planner; only handle
  // the pure "link owns the tab" shape here.
  if (p.runs.some((r) => r.kind === "text" && r.text.includes("\t"))) return null;
  const hi = p.runs.findIndex((r) => r.kind === "hyperlink" && hyperlinkContainsTab(r.children));
  if (hi === -1) return null;
  const link = p.runs[hi] as HyperlinkRun;

  // Split at the LAST tab child: Word advances it to the right leader
  // stop, right-aligning the page number. An earlier number→title tab
  // stays in the before-link and renders against its own (left) stop.
  let tabChild = -1;
  let tabChar = -1;
  for (let i = 0; i < link.children.length; i++) {
    const c = link.children[i]!;
    if (c.kind !== "text") continue;
    const idx = c.text.lastIndexOf("\t");
    if (idx !== -1) {
      tabChild = i;
      tabChar = idx;
    }
  }
  if (tabChild === -1) return null;

  const host = link.children[tabChild] as TextRun;
  const pre = host.text.slice(0, tabChar);
  const post = host.text.slice(tabChar + 1);
  const beforeChildren: InlineRun[] = [...link.children.slice(0, tabChild)];
  if (pre) beforeChildren.push({ ...host, text: pre });
  const afterChildren: InlineRun[] = [];
  if (post) afterChildren.push({ ...host, text: post });
  afterChildren.push(...link.children.slice(tabChild + 1));

  const before: InlineRun[] = [...p.runs.slice(0, hi)];
  if (beforeChildren.length > 0) before.push({ ...link, children: beforeChildren });
  const after: InlineRun[] = [{ ...link, children: afterChildren }, ...p.runs.slice(hi + 1)];

  return buildRightTailPlan(before, after, "\t", rightStop, effective);
}

/**
 * Shared assembly for a right-tail plan once the runs are split into
 * `before` / `after` around the tail tab (top-level or link-nested).
 * Owns the geometry: the tail's distance-from-right, the entry's
 * first-line indent, and the leader fill.
 */
function buildRightTailPlan(
  before: InlineRun[],
  after: InlineRun[],
  separatorText: string,
  tailStop: TabStop,
  effective: ParagraphProperties,
): RightTailPlan | null {
  if (!hasVisibleContent(after)) return null;

  // `w:pos` is measured from the text margin; the paragraph's content
  // box is already shifted right by its left indent, so the tail's
  // distance-from-right is (100% of the box) minus (pos − left indent).
  // For the common TOC case (stop at the column edge) this resolves to
  // ~0; a stop beyond the edge goes slightly negative and the tail
  // overflows — the same thing Word does.
  const offsetTwips = tailStop.positionTwips - (effective.indent?.leftTwips ?? 0);
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

  const leaderChar = tailStop.leader ? LEADER_FILL_CHAR[tailStop.leader] : undefined;
  // Size the tail box to its own text, but ONLY for leader lines. The
  // flex collapse that necessitates a definite width is caused by the
  // elastic 512-glyph leader beside the tail; a leaderless right-tab
  // (e.g. a "org … Page N" footer) sizes its tail naturally and must not
  // get a fixed `ch` box (that clipped/wrapped multi-word tails). Digits
  // / roman numerals are ~1ch each; `text-align: right` pins the number
  // to the stop, and a wider glyph overflows LEFT into the leader rather
  // than clipping, so the tight box keeps the dots against the number.
  const tailChars = leaderChar ? tailTextLength(after) : 0;
  return {
    before,
    after,
    separatorText,
    ...(leaderChar ? { leaderFill: leaderChar.repeat(LEADER_FILL_CAPACITY) } : {}),
    tailMarginRight,
    ...(beforeMarginLeft ? { beforeMarginLeft } : {}),
    ...(tailChars > 0 ? { tailWidthCh: tailChars } : {}),
  };
}

/** Character count of the tail's rendered text (descending into a
 *  hyperlink), used to size the atomic tail box in `ch`. Internal spaces
 *  count — only the outer ends are trimmed — so a multi-glyph tail box is
 *  wide enough for the whole run. */
function tailTextLength(runs: readonly InlineRun[]): number {
  return tailText(runs).trim().length;
}

function tailText(runs: readonly InlineRun[]): string {
  let s = "";
  for (const r of runs) {
    if (r.kind === "text") s += r.text;
    else if (r.kind === "hyperlink") s += tailText(r.children);
  }
  return s;
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
