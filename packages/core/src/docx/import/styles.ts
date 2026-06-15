/**
 * Parse `word/styles.xml` into a `NamedStyle[]`.
 *
 * Word's styles.xml is a long catalogue of `<w:style>` definitions plus
 * a single `<w:docDefaults>` block carrying the document-wide rPr / pPr
 * defaults. Without this, every imported docx falls back to Sobree's
 * synthesised `defaultStyles()` (Helvetica 11pt, Word-hardcoded
 * spacing) which mismatches whatever the docx author actually chose.
 *
 * Coverage:
 *   - `<w:style>` rPr → RunProperties: `rFonts.ascii`, `sz` (half-pts),
 *     `b`, `i`, `u`, `color`, `vertAlign`.
 *   - `<w:style>` pPr → ParagraphProperties: `jc`, `spacing.{line,
 *     lineRule, before, after}`, `ind.{left, right}`.
 *   - `<w:basedOn>`, `<w:next>`, `<w:name>`.
 *   - `<w:docDefaults>` is folded into a synthetic Normal-basis
 *     style — anything unspecified there falls through to Word's
 *     hardcoded baseline.
 *
 * Out of scope (silently dropped): table styles, numbering styles,
 * conditional formatting (`<w:tblStylePr>`), advanced font hints
 * (`hAnsi`, `cs`, `eastAsia`), runs without a recognised property.
 */

import { resolveStyleCascade } from "../../doc/styles";
import type {
  NamedStyle,
  ParagraphAlignment,
  ParagraphIndent,
  ParagraphProperties,
  ParagraphSpacing,
  RunProperties,
} from "../../doc/types";
import { NS } from "../shared/namespaces";
import { readShading } from "../shared/shading";
import { parseXml, wAll, wFirst, wOnOff, wVal } from "../shared/xml";
import { readParagraphBorders } from "./borders";
import { type DocSettings, shouldApplyAutoSpacing } from "./settings";

/**
 * Canonicalise a heading style id to `HeadingN`.
 *
 * Word and OpenOffice name the heading styles inconsistently across docs:
 * `Heading2`, `Heading 2`, `heading 2`. The paragraph importer already
 * maps a heading PARAGRAPH's styleId to the canonical `HeadingN` (so it
 * renders as `<hN>` and joins the `HeadingN` convention used by builders /
 * serialize / markdown). The STYLE definition must canonicalise the same
 * way, or `resolveStyleCascade` looks up `HeadingN` and misses the
 * actual style — dropping its colour, caps, etc. Non-heading ids pass
 * through unchanged.
 */
export function canonicalStyleId(id: string): string {
  const m = id.match(/^heading\s*([1-6])$/i);
  return m ? `Heading${m[1]}` : id;
}

export function parseStylesXml(
  xml: string | undefined,
  settings: DocSettings = { doNotUseHTMLParagraphAutoSpacing: false },
): NamedStyle[] | null {
  if (!xml) return null;
  let doc: Document;
  try {
    doc = parseXml(xml);
  } catch {
    return null;
  }
  const out: NamedStyle[] = [];

  // 1. Synthesise a Normal-or-equivalent style from <w:docDefaults> so
  //    docs whose styles.xml omits an explicit Normal still pick up
  //    document-wide rPr / pPr (the doc default for everything).
  const docDefaults = wFirst(doc, "docDefaults");
  if (docDefaults) {
    const rPrDefault = wFirst(docDefaults, "rPrDefault");
    const pPrDefault = wFirst(docDefaults, "pPrDefault");
    const rDef = rPrDefault ? wFirst(rPrDefault, "rPr") : null;
    const pDef = pPrDefault ? wFirst(pPrDefault, "pPr") : null;
    const runDefaults = rDef ? readRunProperties(rDef) : undefined;
    const paragraphDefaults = pDef ? readParagraphProperties(pDef) : undefined;
    if (runDefaults || paragraphDefaults) {
      out.push({
        id: "DocDefaults",
        type: "paragraph",
        displayName: "Document defaults",
        ...(runDefaults ? { runDefaults } : {}),
        ...(paragraphDefaults ? { paragraphDefaults } : {}),
      });
    }
  }

  // 2. Walk every <w:style> element. Each becomes a NamedStyle.
  for (const styleEl of wAll(doc, "style")) {
    const rawStyleId = styleEl.getAttributeNS(NS.w, "styleId") ?? styleEl.getAttribute("w:styleId");
    if (!rawStyleId) continue;
    // Canonicalise heading ids (`Heading 2` / `heading 2` → `Heading2`).
    // The paragraph importer canonicalises a heading PARAGRAPH's styleId
    // the same way; the STYLE definition must match or the cascade can't
    // resolve it and the heading's colour / caps are silently dropped.
    const styleId = canonicalStyleId(rawStyleId);
    const typeAttr = styleEl.getAttributeNS(NS.w, "type") ?? styleEl.getAttribute("w:type");
    const type = mapStyleType(typeAttr);
    if (!type) continue; // skip unknown style types silently

    const displayName = wVal(wFirst(styleEl, "name")) ?? rawStyleId;
    // basedOn / next reference style ids too — canonicalise so a chain
    // through a renamed heading style stays linked.
    const basedOn = wVal(wFirst(styleEl, "basedOn"));
    const nextStyleId = wVal(wFirst(styleEl, "next"));

    const rPr = wFirst(styleEl, "rPr");
    const pPr = wFirst(styleEl, "pPr");
    const runDefaults = rPr ? readRunProperties(rPr) : undefined;
    const paragraphDefaults = pPr ? readParagraphProperties(pPr) : undefined;

    out.push({
      id: styleId,
      type,
      displayName,
      ...(basedOn ? { basedOn: canonicalStyleId(basedOn) } : {}),
      ...(nextStyleId ? { nextStyleId: canonicalStyleId(nextStyleId) } : {}),
      ...(runDefaults ? { runDefaults } : {}),
      ...(paragraphDefaults ? { paragraphDefaults } : {}),
    });
  }

  // 3. Wire up: every paragraph style without an explicit basedOn is
  //    based on DocDefaults (when present) so the document-wide
  //    typography flows in via the cascade. Skip "Normal" itself if
  //    DocDefaults exists (Normal becomes basedOn=DocDefaults).
  if (docDefaults) {
    for (const style of out) {
      if (style.id === "DocDefaults") continue;
      if (style.type !== "paragraph") continue;
      if (style.basedOn) continue;
      style.basedOn = "DocDefaults";
    }
  }

  // 4. Word-hardcoded baseline. The OOXML spec says "if not specified,
  //    behaviour is implementation-defined." In practice Word renders
  //    a styles-empty Normal with `line=276` (1.15×) and `after=160`
  //    twips (8pt) — that's what gives bare paragraphs visible
  //    breathing in Word even when the docx doesn't declare it.
  //
  //    We pin those values onto the resolved cascade for whichever
  //    style is the document default for paragraphs (Normal, or the
  //    one tagged `<w:default w:val="1"/>` if styles.xml uses that).
  //    Properties already specified by the docx win.
  ensureWordBaseline(out, doc, shouldApplyAutoSpacing(settings));

  return out.length > 0 ? out : null;
}

/**
 * Apply Word's hardcoded baseline to whichever paragraph style is the
 * document default — matches what Word renders when styles.xml leaves
 * properties unspecified. Anything the docx already declares wins.
 *
 * Two pieces of baseline currently:
 *
 *   - **Run defaults**: font `Calibri`, size 11pt. Word's bare Normal
 *     style renders with these even when its `<w:rPr>` is empty
 *     (Word's hardcoded run baseline for the "minor latin" font slot,
 *     which is what plain Latin runs land in). Without this, bare
 *     paragraphs render in the browser default (Times New Roman 16px
 *     for most browsers) and diverge from Word on the very first
 *     character.
 *   - **Paragraph defaults**: `line=276` (1.15×) + `after=160` (8pt).
 *     Word's hardcoded paragraph baseline.
 *
 * The default style is the one with `<w:style w:default="1">` (Word's
 * way of marking "the default style for this type") OR, failing that,
 * the style id `Normal`.
 */
function ensureWordBaseline(styles: NamedStyle[], doc: Document, applyAutoSpacing: boolean): void {
  // Find the explicit default-paragraph-style id from styles.xml
  // attribute markers.
  let defaultStyleId: string | undefined;
  for (const styleEl of wAll(doc, "style")) {
    const type = styleEl.getAttributeNS(NS.w, "type") ?? styleEl.getAttribute("w:type");
    if (type !== "paragraph") continue;
    const isDefault = styleEl.getAttributeNS(NS.w, "default") ?? styleEl.getAttribute("w:default");
    if (isDefault === "1" || isDefault === "true") {
      defaultStyleId =
        styleEl.getAttributeNS(NS.w, "styleId") ?? styleEl.getAttribute("w:styleId") ?? undefined;
      break;
    }
  }
  defaultStyleId = defaultStyleId ?? "Normal";

  // If the docx omits the default style entirely (docx-library
  // generates this shape — empty <w:docDefaults/>, no <w:style
  // w:styleId="Normal">), synthesize it. Word's hardcoded behaviour
  // is to fall back to its own Normal-style baseline; we do the same
  // by materialising a Normal-equivalent here so the cascade has
  // something to resolve to. basedOn `DocDefaults` if we read one,
  // otherwise undefined.
  let target = styles.find((s) => s.id === defaultStyleId);
  if (!target) {
    const hasDocDefaults = styles.some((s) => s.id === "DocDefaults");
    target = {
      id: defaultStyleId,
      type: "paragraph",
      displayName: defaultStyleId,
      ...(hasDocDefaults ? { basedOn: "DocDefaults" } : {}),
    };
    styles.push(target);
    // Re-wire other paragraph styles that don't yet have a basedOn
    // (they should chain through our synthesized default now).
    for (const s of styles) {
      if (s === target || s.id === "DocDefaults") continue;
      if (s.type !== "paragraph") continue;
      if (s.basedOn) continue;
      s.basedOn = defaultStyleId;
    }
  }

  // --- Run defaults: font / size ---
  // Only inject Calibri 11pt for fields the *cascade* doesn't already
  // provide. If the docx ships a `<w:docDefaults>` with rFonts set
  // (e.g. user-contract.docx declares Times New Roman for the whole
  // document), Normal inherits via `basedOn: "DocDefaults"` and the
  // cascade resolves to that font — injecting Calibri here would
  // override the author's choice, breaking visual fidelity with Word.
  //
  // The check resolves the chain (Normal → basedOn → … → DocDefaults)
  // and only fills in fields no ancestor specifies. Word's hardcoded
  // Calibri-11pt baseline is the last-resort fallback, not an override.
  const resolved = resolveStyleCascade(styles, defaultStyleId);
  const existingRuns = target.runDefaults ?? {};
  const inheritedFontFamily = resolved.runDefaults.fontFamily;
  const inheritedFontSize = resolved.runDefaults.fontSizePt;
  target.runDefaults = {
    ...existingRuns,
    ...(inheritedFontFamily === undefined ? { fontFamily: "Calibri" } : {}),
    ...(inheritedFontSize === undefined ? { fontSizePt: 11 } : {}),
  };

  // --- Paragraph defaults: NO hardcoded spacing baseline ---
  // Earlier rounds injected `line=276 + after=160` here as Word's
  // supposed implicit Normal baseline, but visual comparison against
  // fixtures shows Word actually renders TIGHT when both Normal and
  // pPrDefault are empty — even with compatibilityMode 15. The visible
  // breathing in real Word docs (user contract) comes instead from
  // the font's natural leading being multiplied into `lineRule=auto`
  // line values — see the renderer (`block.ts`)'s line-height formula
  // for the calibration. `applyAutoSpacing` is read for future use
  // (e.g. autoSpacing toggles on specific styles) but currently no
  // baseline is injected here.
  void applyAutoSpacing;

  // --- Heading baselines ---
  // Word's hardcoded heading defaults: each heading style has
  // `before/after` spacing + `keepNext: true` even when styles.xml
  // doesn't declare them. The docx-library-generated docx (and many
  // other authors) leave HeadingN.pPr empty, relying on Word's
  // built-in baseline; we inject it here for the same reason as the
  // Normal baseline above.
  //
  // Sizes calibrated from Word's "Latent Styles" defaults:
  //   - Heading1: 240 before, 0 after (12pt + 0)
  //   - Heading2: 200 before, 0 after
  //   - Heading3-6: 160 before, 0 after
  // All keepNext (the heading stays glued to whatever follows).
  for (let level = 1; level <= 6; level++) {
    const styleId = `Heading${level}`;
    const heading = styles.find((s) => s.id === styleId);
    if (!heading) continue;
    if (!heading.paragraphDefaults) {
      const beforeTwips = level === 1 ? 240 : level === 2 ? 200 : 160;
      heading.paragraphDefaults = {
        spacing: { beforeTwips, afterTwips: 0, line: 240, lineRule: "auto" },
        keepNext: true,
      };
    }
    // Heading font baseline: Word's modern theme uses "Calibri Light"
    // for headings (the "Major Latin" font slot in the theme). When the
    // docx doesn't declare a font on the Heading style (typical — the
    // theme provides it), inject Calibri Light so headings render with
    // their distinct typographic voice. Other run-default fields the
    // docx already set (color, fontSizePt) are preserved.
    const existing = heading.runDefaults ?? {};
    heading.runDefaults = {
      ...existing,
      fontFamily: existing.fontFamily ?? "Calibri Light",
    };
  }

  // Hyperlink character-style baseline. Word's latent-style default
  // renders links #0563C1 + underlined even when styles.xml never
  // defines "Hyperlink" — runs reference it via `<w:rStyle>` regardless.
  // Sobree's `<a>` is appearance-neutral (CSS `color: inherit`), so
  // without this injected definition such links would render as plain
  // body text. A docx-defined Hyperlink style wins untouched.
  if (!styles.some((s) => s.id === "Hyperlink")) {
    styles.push({
      id: "Hyperlink",
      type: "character",
      displayName: "Hyperlink",
      runDefaults: { color: "#0563C1", underline: "single" },
    });
  }
}

// ---------- per-element readers ----------

function mapStyleType(raw: string | null): NamedStyle["type"] | null {
  switch (raw) {
    case "paragraph":
      return "paragraph";
    case "character":
      return "character";
    case "table":
      return "table";
    case "numbering":
      return "numbering";
    default:
      return null;
  }
}

function readRunProperties(rPr: Element): RunProperties | undefined {
  const out: RunProperties = {};
  // <w:rFonts w:ascii="..."/> — Word stores up to four font slots
  // (ascii / hAnsi / eastAsia / cs). We only honour ascii for now;
  // it's the slot Word picks for Latin text, which covers > 99% of
  // visible runs.
  const rFonts = wFirst(rPr, "rFonts");
  if (rFonts) {
    const ascii = rFonts.getAttributeNS(NS.w, "ascii") ?? rFonts.getAttribute("w:ascii");
    if (ascii) out.fontFamily = ascii;
  }
  // <w:sz w:val="22"/> — value is in HALF-POINTS, so 22 = 11pt.
  const szVal = wVal(wFirst(rPr, "sz"));
  if (szVal) {
    const halfPts = Number.parseInt(szVal, 10);
    if (Number.isFinite(halfPts)) out.fontSizePt = halfPts / 2;
  }
  // Boolean toggles — present element + (no `w:val` OR val="1"/"true") = true.
  if (toggleOn(wFirst(rPr, "b"))) out.bold = true;
  if (toggleOn(wFirst(rPr, "i"))) out.italic = true;
  const u = wFirst(rPr, "u");
  if (u) {
    const v = wVal(u);
    if (v && v !== "none") {
      // Treat unknown values as "single" — Word has many underline
      // styles (wave, dotted, dashLong, …) but we expose only the
      // canonical set; coerce to the closest renderable.
      out.underline =
        v === "single" || v === "double" || v === "dotted" || v === "dashed" || v === "wave"
          ? v
          : "single";
    } else if (v === null) {
      // No w:val attribute = single underline by default in OOXML.
      out.underline = "single";
    }
  }
  if (toggleOn(wFirst(rPr, "strike"))) out.strike = true;
  // `<w:caps/>` cascading through a named style — same toggle behaviour
  // as `bold` / `italic`. Mirrors the per-run read in `runs.ts`.
  if (toggleOn(wFirst(rPr, "caps"))) out.caps = true;
  // <w:color w:val="FF0000"/> or "auto"
  const colorVal = wVal(wFirst(rPr, "color"));
  if (colorVal && colorVal !== "auto") {
    out.color = colorVal.startsWith("#") ? colorVal : `#${colorVal}`;
  }
  // <w:vertAlign w:val="superscript"/>
  const vAlign = wVal(wFirst(rPr, "vertAlign"));
  if (vAlign === "superscript" || vAlign === "subscript") {
    out.verticalAlign = vAlign;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readParagraphProperties(pPr: Element): ParagraphProperties | undefined {
  const out: ParagraphProperties = {};

  // <w:jc w:val="left|center|right|both"/>
  const jc = wVal(wFirst(pPr, "jc"));
  const alignment = mapAlignment(jc);
  if (alignment) out.alignment = alignment;

  // <w:spacing w:line="276" w:lineRule="auto" w:before="240" w:after="120"/>
  const spacing = wFirst(pPr, "spacing");
  if (spacing) {
    const sp: ParagraphSpacing = {};
    const line = readNumAttr(spacing, "line");
    if (line !== null) sp.line = line;
    const lineRule = spacing.getAttributeNS(NS.w, "lineRule") ?? spacing.getAttribute("w:lineRule");
    if (lineRule === "auto" || lineRule === "exact" || lineRule === "atLeast") {
      sp.lineRule = lineRule;
    }
    const before = readNumAttr(spacing, "before");
    if (before !== null) sp.beforeTwips = before;
    const after = readNumAttr(spacing, "after");
    if (after !== null) sp.afterTwips = after;
    if (Object.keys(sp).length > 0) out.spacing = sp;
  }

  // <w:ind w:left="720" w:right="720"/>
  const ind = wFirst(pPr, "ind");
  if (ind) {
    const indent: ParagraphIndent = {};
    const left = readNumAttr(ind, "left");
    if (left !== null) indent.leftTwips = left;
    const right = readNumAttr(ind, "right");
    if (right !== null) indent.rightTwips = right;
    if (Object.keys(indent).length > 0) out.indent = indent;
  }

  // <w:pageBreakBefore/> — a CT_OnOff toggle. Honour the explicit-off
  // form (`w:val="0"`) Word writes in DocDefaults / styles; reading by
  // presence alone would inherit a page break onto every paragraph.
  if (wOnOff(pPr, "pageBreakBefore")) out.pageBreakBefore = true;

  // <w:pBdr> — divider rules. Word puts the top/bottom rule of a
  // letterhead/résumé header on a STYLE (e.g. a "Name" style's top rule),
  // so read it here too, not just on direct paragraphs.
  const borders = readParagraphBorders(pPr);
  if (borders) out.borders = borders;

  // <w:shd w:val="clear" w:fill="…"/> — paragraph background colour.
  const shading = readShading(pPr);
  if (shading) out.shading = shading;

  return Object.keys(out).length > 0 ? out : undefined;
}

function mapAlignment(raw: string | null): ParagraphAlignment | null {
  switch (raw) {
    case "left":
    case "right":
    case "center":
      return raw;
    case "both":
    case "justify":
      return "both";
    case "distribute":
      return "distribute";
    default:
      return null;
  }
}

function toggleOn(el: Element | null): boolean {
  if (!el) return false;
  const v = wVal(el);
  return v === null || v === "1" || v === "true";
}

function readNumAttr(el: Element, name: string): number | null {
  const v = el.getAttributeNS(NS.w, name) ?? el.getAttribute(`w:${name}`);
  if (v === null) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
