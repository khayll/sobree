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

import { resolveStyleCascade } from "../../../doc/styles";
import type { NamedStyle, ParagraphProperties, RunProperties } from "../../../doc/types";
import { resolveFontFace } from "./fontFallback";
import { twipsToMm } from "./units";

export function applyParagraphProps(
  el: HTMLElement,
  props: ParagraphProperties,
  styles: readonly NamedStyle[] = [],
): RunProperties {
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
      ? resolveStyleCascade(styles, effectiveStyleId)
      : { runDefaults: {}, paragraphDefaults: {} };
  const effective: ParagraphProperties = mergeParagraphProperties(paragraphDefaults, props);
  // Overlay the paragraph's OWN `runDefaults` on top of the style
  // cascade. `pPr/rPr` carries the paragraph-mark font (e.g. an
  // 8pt Arial in jellap.docx's header contact lines, or 9pt Times
  // for form-field empties); without overlaying here the cascade
  // wins and we render those paragraphs at the style's default font
  // (often 12pt Calibri from DocDefaults), throwing every line-height
  // calculation off.
  const runDefaults = { ...cascadeRunDefaults, ...(props.runDefaults ?? {}) };

  if (runDefaults.fontFamily) {
    // A face NAME ("Helvetica Neue Light") resolves to family + implied
    // weight/style; the explicit bold/italic assignments below override
    // the implied ones when the cascade sets them.
    const face = resolveFontFace(runDefaults.fontFamily);
    el.style.fontFamily = face.stack;
    if (face.weight !== undefined) el.style.fontWeight = String(face.weight);
    if (face.italic) el.style.fontStyle = "italic";
  }
  if (runDefaults.fontSizePt !== undefined) {
    el.style.fontSize = `${runDefaults.fontSizePt}pt`;
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
  if (effective.alignment) {
    el.style.textAlign = effective.alignment === "both" ? "justify" : effective.alignment;
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
    // `line=240` (single) keeps the `normal` shortcut so the browser
    // uses its own native leading for the font; only multi-line rules
    // need the explicit `line-height: N` declaration to scale.
    if (effective.spacing.line === 240) {
      el.style.lineHeight = "normal";
    } else {
      const naturalLeading = naturalLeadingFor(runDefaults.fontFamily);
      el.style.lineHeight = String((effective.spacing.line / 240) * naturalLeading);
    }
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
    const fontSizePt = runDefaults.fontSizePt;
    if (
      fontSizePt !== undefined &&
      minPt > naturalLeadingFor(runDefaults.fontFamily) * fontSizePt
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
  if (effective.spacing?.beforeTwips !== undefined) {
    el.style.marginTop = `${twipsToMm(effective.spacing.beforeTwips)}mm`;
  }
  if (effective.spacing?.afterTwips !== undefined) {
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
  // <w:shd w:fill="…"/> on the paragraph — paragraph background colour.
  if (effective.shading?.fill && effective.shading.fill !== "#auto") {
    el.style.backgroundColor = effective.shading.fill;
  }
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
  return runDefaults;
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
  return {
    ...base,
    ...over,
    spacing: { ...base.spacing, ...over.spacing },
    indent: { ...base.indent, ...over.indent },
    borders: { ...base.borders, ...over.borders },
  };
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
function naturalLeadingFor(fontFamily: string | undefined): number {
  if (!fontFamily) return 1.15;
  // All current targets (Calibri/Carlito included) match LibreOffice at a
  // ~1.15 natural leading. An earlier 1.05 special-case for Calibri was a
  // mis-calibration: it was tuned to hit LO's line spacing while the run
  // default font size was wrongly 11pt, so 11×1.05 happened to equal the
  // true 10×1.15 for `line=360`. With the font-size default corrected to
  // 10pt, the genuine 1.15 leading applies uniformly.
  return 1.15;
}

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
