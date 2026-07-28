/**
 * Paragraph-property → CSS derivation.
 *
 * `applyParagraphProps` is the single place that turns a paragraph's
 * resolved `ParagraphProperties` (after the style cascade) into inline
 * CSS on its rendered element: font, colour, alignment, line-height,
 * spacing, indent, borders, shading, page-break / keep-next hints,
 * and tab geometry.
 *
 * CSS owns layout / interaction; the document owns typography. Every
 * value applied here comes from the AST + the document's style chain —
 * there are no CSS-only typography fallbacks.
 */

import { mergeTabStops, resolveRunStyle, resolveStyleCascade } from "../../../doc/styles";
import type { InlineRun, NamedStyle, ParagraphProperties, RunProperties } from "../../../doc/types";
import { resolveFontFace } from "./fontFallback";
import { resolveShadingColor } from "./shadingColor";
import { twipsToMm } from "./units";

/**
 * Whether each side of a paragraph sits next to a same-style paragraph.
 * Used to resolve `<w:contextualSpacing/>`: the before/after margin is
 * dropped only when the corresponding neighbour shares this paragraph's
 * style. The block walker (`renderBlocks`) owns the sequence and computes
 * these; `applyParagraphProps` combines them with the resolved
 * `contextualSpacing` flag (which may come from the style cascade).
 */
export interface ContextualNeighbors {
  prevSameStyle: boolean;
  nextSameStyle: boolean;
}

/** Result of {@link applyParagraphProps}: the run defaults for per-run
 *  toggle resolution, plus the cascade-resolved paragraph properties so
 *  callers that need the effective values (e.g. the tab-layout planner
 *  reading style-cascaded `tabStops` / `indent`) don't re-run the
 *  cascade. */
export interface AppliedParagraphProps {
  runDefaults: RunProperties;
  effective: ParagraphProperties;
}

export function applyParagraphProps(
  el: HTMLElement,
  props: ParagraphProperties,
  styles: readonly NamedStyle[] = [],
  contextualNeighbors: ContextualNeighbors = { prevSameStyle: false, nextSameStyle: false },
  /** `w:tblStyle` of the CONTAINING table — layers the table style's own
   *  pPr/rPr under the paragraph style (ECMA-376 §17.7.2); see
   *  `resolveStyleCascade`. */
  tableStyleId?: string,
  /** True when the paragraph has NO content runs. The paragraph-MARK
   *  rPr (`props.runDefaults`, `<w:pPr><w:rPr>`) styles ONLY the ¶ glyph
   *  (§17.3.1.29): it governs an EMPTY paragraph's line height, but must
   *  NOT reach content runs (they inherit from the style cascade). */
  isEmptyParagraph = false,
  /** The paragraph's content runs. Used to derive the ELEMENT's own font
   *  (the line-box strut size + the unitless-line-height leading font)
   *  from the DOMINANT content rather than the cascade default. */
  contentRuns: readonly InlineRun[] = [],
): AppliedParagraphProps {
  // Resolve the style cascade for both run + paragraph defaults, then
  // overlay the paragraph's own properties so explicit settings win on
  // conflict.
  // Bare paragraphs without an explicit `styleId` inherit from
  // "Normal" — same behaviour as Word's pStyle-default. The cascade
  // walks `Normal → docDefaults` (when present) under the hood; a
  // missing "Normal" style returns empty defaults safely.
  const effectiveStyleId = props.styleId ?? "Normal";
  const { runDefaults: cascadeRunDefaults, paragraphDefaults } =
    styles.length > 0
      ? resolveStyleCascade(styles, effectiveStyleId, tableStyleId ? { tableStyleId } : undefined)
      : { runDefaults: {}, paragraphDefaults: {} };
  const effective: ParagraphProperties = mergeParagraphProperties(paragraphDefaults, props);
  // The paragraph-MARK rPr (`props.runDefaults`, `<w:pPr><w:rPr>`) styles
  // only the ¶ glyph (§17.3.1.29), so for CONTENT runs it is a FALLBACK
  // that fills what the style cascade leaves unset — never an override.
  //   - EMPTY paragraph: the ¶ mark IS the content, so it wins.
  //   - CONTENT paragraph: the cascade wins; the mark only supplies
  //     properties the cascade omits (a form whose cascade declares no
  //     size at all still needs the mark's size).
  // Overriding with the mark rendered the Wisconsin recipe's legend 12pt
  // (its 12pt Lato ¶ mark over runs that inherit 10pt from the cascade),
  // ~20% too wide, running under the behind-text corner logo.
  const markRpr = props.runDefaults ?? {};
  let runDefaults: RunProperties;
  if (isEmptyParagraph) {
    runDefaults = { ...cascadeRunDefaults, ...markRpr };
  } else {
    // Content paragraph: the mark supplies font/colour the cascade omits
    // (kept), but its SIZE must not override the cascade — that is the
    // property that widened the recipe legend. Cascade size wins when it
    // has one; the mark's size only survives where the cascade is silent.
    runDefaults = { ...cascadeRunDefaults, ...markRpr };
    if (cascadeRunDefaults.fontSizePt !== undefined) {
      runDefaults = { ...runDefaults, fontSizePt: cascadeRunDefaults.fontSizePt };
    }
  }

  // The ELEMENT's own font drives its line-box STRUT (element font-size ×
  // the unitless line-height) and the leading FONT (`naturalLeadingFor`),
  // so it must reflect the paragraph's DOMINANT CONTENT — not the cascade
  // default. jellap.docx's 9pt Times form under a 12pt-Calibri cascade
  // otherwise drew 2×1.2217×12px line boxes (Calibri leading, 12pt strut)
  // and grew a page. Content runs still INHERIT from `runDefaults` above;
  // a sizeless/fontless run counts at that inherited value.
  const elementFont = dominantElementFont(contentRuns, runDefaults, isEmptyParagraph, styles);
  if (elementFont.fontFamily) {
    // A face NAME ("Helvetica Neue Light") resolves to family + implied
    // weight/style; the explicit bold/italic assignments below override
    // the implied ones when the cascade sets them.
    const face = resolveFontFace(elementFont.fontFamily);
    el.style.fontFamily = face.stack;
    if (face.weight !== undefined) el.style.fontWeight = String(face.weight);
    if (face.italic) el.style.fontStyle = "italic";
  }
  if (elementFont.fontSizePt !== undefined) {
    el.style.fontSize = `${elementFont.fontSizePt}pt`;
  }
  // Apply the rest of the run cascade to the block element so per-run
  // children inherit Word's style-defined colour / weight / italic /
  // underline. Without this, e.g. Heading1's `color: "#2E74B5"`
  // (declared in styles.xml) is parsed into the AST but never makes
  // it onto the rendered `<h1>` — headings render in the default
  // text colour instead of Word's blue.
  if (runDefaults.color)
    el.style.color = runDefaults.color === "auto" ? "currentColor" : runDefaults.color;
  // `underline` is an enum (single / double / dotted / …), NOT an OOXML toggle,
  // so it inherits from the block element. Map any non-"none" value to a plain
  // underline — the exact style is decorative and rarely a single CSS rule.
  if (runDefaults.underline && runDefaults.underline !== "none") {
    el.style.textDecoration = "underline";
  }
  // TOGGLE run properties (bold / italic / strike / caps / smallCaps) are NOT
  // applied to the block element. CSS inheritance can only OR them with a run's
  // own value, but OOXML toggles combine by XOR — so a `caps` paragraph style
  // plus a `caps` character style must CANCEL, not double up (the author-name
  // ALL-CAPS bug). They're resolved per-run in `renderTextRun`, which composes
  // the paragraph run-defaults (returned below) with each run's char style and
  // direct formatting. This function only emits inheritable NON-toggle CSS.

  // Carry the Word style id verbatim so serialize can reconstruct it
  // losslessly. A `data-*` attribute, NOT a CSS class: style ids can
  // contain spaces / mixed case ("Contact Information") that are illegal
  // in class tokens and throw on `classList.add`. Headings are excluded —
  // their id is recovered from the h1-h6 tag on serialize.
  if (props.styleId && !/^Heading[1-6]$/.test(props.styleId)) {
    el.setAttribute("data-style-id", props.styleId);
  }
  // Bidi: `alignment` is LOGICAL (wire `jc`: left ≡ start), so under
  // `<w:bidi/>` the physical mapping swaps left↔right; `dir="rtl"` gives
  // the browser the paragraph direction (absent alignment then falls to
  // `text-align: start` = physical right, Word's RTL default). The DOM
  // serializer applies the exact inverse — keep the two in sync.
  if (effective.bidi) el.dir = "rtl";
  if (effective.alignment) {
    const physical =
      effective.bidi && (effective.alignment === "left" || effective.alignment === "right")
        ? effective.alignment === "left"
          ? "right"
          : "left"
        : effective.alignment;
    el.style.textAlign = physical === "both" ? "justify" : physical;
  }
  if (effective.spacing?.line && effective.spacing.lineRule === "auto") {
    // OOXML's `auto` lineRule means "1 = single line spacing as Word
    // defines it, where single ALREADY includes the font's natural
    // leading". Word's "1.5 lines" is therefore 1.5 × (font-size +
    // natural leading), NOT 1.5 × font-size. CSS's unitless
    // `line-height` is just (multiplier × font-size), so to match Word
    // we multiply by the font's natural leading.
    //
    // Each font has a different built-in leading (declared in its
    // OS/2 + hhea tables and respected by the rasteriser). The values
    // below were measured against LibreOffice's PDF output by the
    // `pnpm fixtures:compare` drift tool — same docx, same font, same
    // line-rule; we ratio LibreOffice's Δy to the font size and back
    // out the leading.
    //
    // `line=240` (single) goes through the SAME formula — never CSS
    // `normal`. Browsers resolve `normal` from rounded font metrics
    // that differ per engine / OS / device-pixel ratio (Times New
    // Roman 12pt measured 18px, 18.398px and 18.5px across Chromium
    // environments), so a page's fill — and therefore its break
    // positions — silently changed with the viewer's machine. Word and
    // LibreOffice always lay out single spacing at the font's design
    // leading (1.15 × 12pt = 13.8pt for Times New Roman, LO-verified),
    // which is exactly this formula at line=240.
    const naturalLeading = naturalLeadingFor(elementFont.fontFamily);
    el.style.lineHeight = String((effective.spacing.line / 240) * naturalLeading);
  } else if (effective.spacing?.line && effective.spacing.lineRule === "exact") {
    // `exact`: a FIXED line height of `line` twips, independent of the
    // font. Word clips content taller than the box; CSS does the same
    // with an absolute `line-height`. Without this the line fell back to
    // the font's natural leading — the stat fact-sheet's STAT (28pt font,
    // line=640=32pt exact) and StatDescription paragraphs rendered ~40%
    // tall, overrunning the column. `line` is twips → pt (20 twips = 1pt).
    el.style.lineHeight = `${effective.spacing.line / 20}pt`;
  } else if (effective.spacing?.line && effective.spacing.lineRule === "atLeast") {
    // `atLeast`: a MINIMUM line height of `line` twips. The font's natural
    // leading satisfies it in the COMMON case (specified ≤ natural), and
    // there a fixed `line-height` would wrongly CLIP a taller inline. But
    // Word DOES grow every line to the minimum when it EXCEEDS natural —
    // the ACM submission template sets `Para` = atLeast 270 (13.5pt) over a
    // 9pt font whose natural leading is only ~10.4pt, so leaving it natural
    // packs the body ~25% too tight and over-fills pages. Apply the
    // absolute minimum only when it provably exceeds natural (font size
    // known); otherwise leave `normal` so taller content can still grow.
    const minPt = effective.spacing.line / 20;
    const fontSizePt = elementFont.fontSizePt;
    if (
      fontSizePt !== undefined &&
      minPt > naturalLeadingFor(elementFont.fontFamily) * fontSizePt
    ) {
      el.style.lineHeight = `${minPt}pt`;
    }
  }
  // Spacing applies to LI just as it does to a free paragraph —
  // Word's per-paragraph `<w:spacing w:after>` is the gap BETWEEN
  // consecutive bullets, not just a wrapper concern. Dropping it on
  // LIs (the pre-fix behaviour) collapsed every list to zero inter-
  // bullet gap, packing ~3pt per bullet too tight and cascading into
  // a 2-page short-fall on complex-multipage.docx vs LO.
  // `<w:contextualSpacing/>` collapses the gap to a same-style neighbour:
  // suppress THIS paragraph's before-space when the previous block is a
  // same-style paragraph, and its after-space when the next one is. Word
  // does this so a run of double-spaced body paragraphs (or tight bullets)
  // shows no inter-paragraph gap — without it every such paragraph keeps
  // its cascaded `after` (e.g. docDefaults 160 twips), inflating page count
  // (~5 extra pages on a 27-page thesis).
  const suppressBefore = effective.contextualSpacing === true && contextualNeighbors.prevSameStyle;
  const suppressAfter = effective.contextualSpacing === true && contextualNeighbors.nextSameStyle;
  if (effective.spacing?.beforeTwips !== undefined && !suppressBefore) {
    el.style.marginTop = `${twipsToMm(effective.spacing.beforeTwips)}mm`;
  }
  if (effective.spacing?.afterTwips !== undefined && !suppressAfter) {
    el.style.marginBottom = `${twipsToMm(effective.spacing.afterTwips)}mm`;
  }
  const isLi = el.tagName === "LI";
  if (effective.indent?.leftTwips !== undefined && !isLi) {
    // OOXML's `<w:ind w:left>` on a numbered paragraph is the SAME
    // value as the numbering definition's `lvl/pPr/ind/@w:left`. The
    // numbering def already drives the UL's `padding-left`; if we
    // also stamped it as `margin-left` on the LI, the indent would
    // double (text starts at 2 × leftTwips). LIs ignore the paragraph
    // indent here — the UL's padding-left wins. Non-LI paragraphs
    // still get their own indent.
    el.style.marginLeft = `${twipsToMm(effective.indent.leftTwips)}mm`;
  }
  if (effective.indent?.rightTwips !== undefined) {
    el.style.marginRight = `${twipsToMm(effective.indent.rightTwips)}mm`;
  }
  // `<w:ind w:firstLine>` / `<w:ind w:hanging>` — the first line's extra
  // indent (firstLine, +) or outdent (hanging, −) vs the body, as CSS
  // `text-indent`. Mutually exclusive in OOXML. LIs are skipped: their
  // first-line hang is driven by the list marker geometry, not here.
  if (!isLi) {
    if (effective.indent?.firstLineTwips !== undefined) {
      el.style.textIndent = `${twipsToMm(effective.indent.firstLineTwips)}mm`;
    } else if (effective.indent?.hangingTwips !== undefined) {
      el.style.textIndent = `-${twipsToMm(effective.indent.hangingTwips)}mm`;
    }
  }
  // Paragraph borders (`<w:pBdr>`). Word's sz is eighths-of-a-point;
  // convert to CSS px (1pt = 96/72 px). All four sides supported so
  // page-header dividers (top/bottom) and decorative box paragraphs
  // (all four sides) render correctly.
  if (effective.borders) {
    for (const side of ["top", "bottom", "left", "right"] as const) {
      const b = effective.borders[side];
      if (!b || b.style === "none") continue;
      const px = Math.max(1, Math.round((b.sizeEighthsOfPt / 8) * (96 / 72)));
      el.style[`border${side[0]!.toUpperCase() + side.slice(1)}` as "borderTop"] =
        `${px}px ${mapBorderStyle(b.style)} ${mapBorderColor(b.color)}`;
    }
  }
  // <w:shd> on the paragraph — background colour, pattern composited.
  const shadingBg = resolveShadingColor(effective.shading);
  if (shadingBg) el.style.backgroundColor = shadingBg;
  if (effective.pageBreakBefore) {
    el.setAttribute("data-page-break-before", "");
  }
  // `keepNext`: the paragraph must travel together with whatever
  // follows on the same page. Stamped here as a data-attribute so the
  // paginator's `buildItems` reads it (mirrors how `pageBreakBefore`
  // becomes `data-page-break-before`).
  if (effective.keepNext) {
    el.setAttribute("data-keep-next", "");
  }
  // `keepLines` (`<w:keepLines/>`): the paragraph's lines must not split
  // across pages — the paginator's monolithic/keep-together treatment.
  if (effective.keepLines) {
    el.setAttribute("data-keep-together", "");
  }
  // Custom tab stops (`<w:pPr><w:tabs>`) → CSS `tab-size` so `\t`
  // characters in run text honour Word's stop geometry. We use the
  // smallest stop's position as the tab width — a strict approximation:
  // only correct when all stops are evenly spaced and tabs always land
  // on the first stop. Fine for the common case (header label/value
  // column, form fields like "Cím: \t 1012 Budapest"); mixed-position
  // layouts will drift. CSS `tab-size: <length>` is honoured by
  // browsers when `white-space` preserves whitespace (we set
  // `pre-wrap` on paragraphs globally).
  if (effective.tabStops && effective.tabStops.length > 0) {
    const minTwips = Math.min(...effective.tabStops.map((s) => s.positionTwips));
    if (minTwips > 0) {
      el.style.setProperty("tab-size", `${twipsToMm(minTwips)}mm`);
      // Browsers also need the prefixed -moz- variant in older versions.
      el.style.setProperty("-moz-tab-size", `${twipsToMm(minTwips)}mm`);
    }
  }
  // The resolved run defaults are the base for per-run toggle resolution in
  // `renderTextRun` — returned so callers can thread them into the run walk.
  return { runDefaults, effective };
}

/**
 * Merge `over` into `base` for paragraph properties — `over`'s explicit
 * values win, but its sub-objects (spacing, indent, borders) shallow-
 * merge with `base`'s so partial overrides don't wipe sibling fields.
 *
 * Example: a paragraph that sets only `spacing.afterTwips: 240` should
 * NOT lose the `spacing.line: 276` from its style cascade.
 */
function mergeParagraphProperties(
  base: ParagraphProperties,
  over: ParagraphProperties,
): ParagraphProperties {
  const merged: ParagraphProperties = {
    ...base,
    ...over,
    spacing: { ...base.spacing, ...over.spacing },
    indent: { ...base.indent, ...over.indent },
    borders: { ...base.borders, ...over.borders },
  };
  // Direct tabs MERGE with the cascade's (§17.3.1.38) — see mergeTabStops.
  if (base.tabStops && over.tabStops) {
    merged.tabStops = mergeTabStops(base.tabStops, over.tabStops);
  }
  return merged;
}

/**
 * Per-font natural-leading lookup (single-line height ÷ design size).
 *
 * Measured against LibreOffice via `pnpm fixtures:compare`. Each font's
 * OS/2 + hhea tables declare a different built-in leading, and Word's
 * `lineRule="auto"` multiplies that, not the design size. Without this
 * adjustment, `line=360` (1.5×) on Calibri 11pt renders ~10% denser in
 * Sobree than in Word.
 *
 * Default 1.15 is the Latin-serif baseline (Times / Bookman / Georgia).
 * Add more entries as drift reports show divergence on real docs.
 */
/**
 * The ELEMENT's own font — the size and family that drive its line-box
 * strut and unitless-line-height leading. Derived from the DOMINANT
 * (modal, by character count) CONTENT run, so the element's line metrics
 * match the text most of the paragraph is set in, not the cascade
 * default. A sizeless / fontless run counts at the cascade value (what it
 * actually inherits). An EMPTY paragraph has no content, so its ¶-mark
 * rPr (over the cascade) IS the element font.
 */
function dominantElementFont(
  runs: readonly InlineRun[],
  fallback: RunProperties,
  isEmpty: boolean,
  styles: readonly NamedStyle[],
): { fontFamily: string | undefined; fontSizePt: number | undefined } {
  if (isEmpty || runs.length === 0) {
    return { fontFamily: fallback.fontFamily, fontSizePt: fallback.fontSizePt };
  }
  const byFont = new Map<string, number>();
  const bySize = new Map<number, number>();
  for (const r of runs) {
    if (r.kind !== "text" || !r.text) continue;
    // Resolve each run's EFFECTIVE font/size the same way `renderTextRun`
    // does — direct rPr wins, else the run's CHARACTER STYLE, else the
    // paragraph run-defaults (`fallback`). Reading only `r.properties`
    // missed sizes carried by an rStyle (ieee body runs get 8pt from a
    // char style, not direct rPr) and mis-picked the 12pt docDefault,
    // inflating the line-box strut.
    const charStyle =
      r.properties.styleId && styles.length > 0
        ? resolveRunStyle(styles, r.properties.styleId)
        : {};
    const f = r.properties.fontFamily ?? charStyle.fontFamily ?? fallback.fontFamily;
    const sz = r.properties.fontSizePt ?? charStyle.fontSizePt ?? fallback.fontSizePt;
    if (f !== undefined) byFont.set(f, (byFont.get(f) ?? 0) + r.text.length);
    if (sz !== undefined) bySize.set(sz, (bySize.get(sz) ?? 0) + r.text.length);
  }
  const modal = <T>(m: Map<T, number>): T | undefined =>
    [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  // SIZE + FONT = the DOMINANT (most characters) content value. This sets
  // the line-box STRUT and the leading multiplier, so it must track the
  // paragraph's bulk text: a 12pt body with a stray 11pt run stays 12pt
  // (a MIN rule wrongly deflated wsu's 12pt body to 11pt), and a 9pt form
  // under a 12pt cascade strut resolves to 9pt (jellap). A larger heading
  // run keeps its own taller line via its own span; the strut only governs
  // lines the modal size dominates.
  return {
    fontFamily: modal(byFont) ?? fallback.fontFamily,
    fontSizePt: modal(bySize) ?? fallback.fontSizePt,
  };
}

function naturalLeadingFor(fontFamily: string | undefined): number {
  const key =
    fontFamily
      ?.split(",")[0]
      ?.trim()
      .replace(/^["']|["']$/g, "")
      .toLowerCase() ?? "";
  return FONT_NATURAL_LEADING[key] ?? 1.15;
}

/**
 * (ascent + descent + lineGap) / unitsPerEm from each font's `hhea`
 * table — the exact ratio Word and LibreOffice use for "single" line
 * spacing. Verified against LO's PDF output: a Calibri 11pt paragraph
 * at `line=264` (1.1×) measures 14.75pt/line = 11 × 1.1 × 1.2217.
 * Rendering Calibri at the serif baseline (1.15) made every line ~6%
 * short; on a dense CV that packed 7 extra lines onto the page and
 * broke a page earlier than Word.
 *
 * The 1.15 fallback IS the correct hhea ratio for the wide serif/sans
 * families (Times New Roman 2355/2048, Arial 2355/2048); metric-clones
 * (Carlito↔Calibri, Liberation↔Times/Arial) share their target's
 * numbers by design.
 */
const FONT_NATURAL_LEADING: Record<string, number> = {
  // Calibri hhea: ascent 1536 + descent 512 + lineGap 454, em 2048.
  calibri: 2502 / 2048,
  // Carlito is Calibri's metric-compatible replacement — same tables.
  carlito: 2502 / 2048,
  // Cambria hhea: ascent 1584 + descent 466 + lineGap 384, em 2048.
  cambria: 2434 / 2048,
  // Caladea is Cambria's metric-compatible replacement.
  caladea: 2434 / 2048,
  // Lato: hhea (1974+426+0) and OS/2 usWin (2296+582) DIVERGE — Word
  // and LibreOffice size the line from the WIN metrics (LO-verified:
  // 10pt Lato rows measure 14.4pt = 1.439×; the hhea ratio 1.2 came
  // up ~2pt short per line). Fonts above happen to agree across
  // tables; when they diverge, the usWin ascent+descent is the rule.
  lato: 2878 / 2000,
};

function mapBorderStyle(s: string): string {
  if (s === "single" || s === "thick") return "solid";
  if (s === "double") return "double";
  if (s === "dashed") return "dashed";
  if (s === "dotted") return "dotted";
  return "solid";
}

function mapBorderColor(c: string): string {
  if (!c || c === "auto") return "currentColor";
  return c.startsWith("#") ? c : `#${c}`;
}
