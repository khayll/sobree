/**
 * Parse `word/numbering.xml` into a `NumberingDefinition[]`.
 *
 * The OOXML numbering model has two layers:
 *
 *   1. `<w:abstractNum>` defines a list "template": one `<w:lvl>` per
 *      indent level with the marker format (`decimal`, `bullet`, …),
 *      the marker text template (`%1.`, `•`, …), and the paragraph
 *      indent that goes with that level.
 *   2. `<w:num>` is a concrete list instance — it references an
 *      `abstractNumId` and is what `<w:numPr>/<w:numId>` on a
 *      paragraph points at.
 *
 * Two `<w:num>` instances can share an `abstractNumId` (Word does
 * this all the time — every fresh numbered list gets a new `numId`
 * but reuses an underlying abstract template). We flatten the
 * reference here so each `NumberingDefinition` carries its own
 * fully-resolved abstract format — simpler for consumers.
 *
 * What we read per level: `numFmt` (decimal / bullet / …), `lvlText`
 * (the marker template), `ind` (left + hanging, in twips). Run
 * properties on the marker (`rPr`) are dropped for now — Word uses
 * them mostly for symbol font on bullets, which we don't render
 * faithfully yet anyway.
 */

import type {
  NumberingDefinition,
  AbstractNumberingFormat,
  NumberingLevel,
  ParagraphIndent,
} from "../../doc/types";
import { parseXml, wAll, wFirst, wVal } from "../shared/xml";
import { NS } from "../shared/namespaces";

export function parseNumberingXml(xml: string | undefined): NumberingDefinition[] {
  if (!xml) return [];
  let doc: Document;
  try {
    doc = parseXml(xml);
  } catch {
    return [];
  }

  // 1. Read each <w:abstractNum>: its own levels plus its style-link
  //    hooks. An abstractNum can DEFER its levels to a numbering style
  //    via `<w:numStyleLink val="X">` (it then carries no <w:lvl> of its
  //    own); the abstractNum that DEFINES style "X" carries
  //    `<w:styleLink val="X">` and the real levels. Both sides live in
  //    numbering.xml, so we match them BY NAME here — no styles.xml
  //    lookup needed. Without this, a bullet list whose abstractNum is a
  //    numStyleLink reads as empty and falls back to `decimal` (renders
  //    numbered instead of bulleted).
  const rawLevels = new Map<number, NumberingLevel[]>();
  const numStyleLinkOf = new Map<number, string>();
  const levelsByStyleDefinition = new Map<string, NumberingLevel[]>();
  for (const absEl of wAll(doc, "abstractNum")) {
    const idStr =
      absEl.getAttributeNS(NS.w, "abstractNumId") ??
      absEl.getAttribute("w:abstractNumId");
    if (!idStr) continue;
    const id = Number.parseInt(idStr, 10);
    if (!Number.isFinite(id)) continue;
    const levels = readLevels(absEl);
    rawLevels.set(id, levels);
    const numStyleLink = wVal(wFirst(absEl, "numStyleLink"));
    if (numStyleLink) numStyleLinkOf.set(id, numStyleLink);
    const styleLink = wVal(wFirst(absEl, "styleLink"));
    if (styleLink) levelsByStyleDefinition.set(styleLink, levels);
  }

  // Resolve numStyleLink references (after the full pass, so the
  // definition is always available regardless of document order): an
  // abstractNum with no levels of its own borrows the linked definition's.
  const abstracts = new Map<number, AbstractNumberingFormat>();
  for (const [id, levels] of rawLevels) {
    const link = numStyleLinkOf.get(id);
    const resolved =
      levels.length === 0 && link ? (levelsByStyleDefinition.get(link) ?? levels) : levels;
    abstracts.set(id, { levels: resolved });
  }

  // 2. Walk every <w:num>, resolve its abstractNumId, emit a
  //    NumberingDefinition carrying the resolved format.
  const out: NumberingDefinition[] = [];
  for (const numEl of wAll(doc, "num")) {
    const numIdStr =
      numEl.getAttributeNS(NS.w, "numId") ?? numEl.getAttribute("w:numId");
    if (!numIdStr) continue;
    const numId = Number.parseInt(numIdStr, 10);
    if (!Number.isFinite(numId)) continue;
    const ref = wFirst(numEl, "abstractNumId");
    const refIdStr = wVal(ref);
    if (!refIdStr) continue;
    const refId = Number.parseInt(refIdStr, 10);
    const abstractFormat = abstracts.get(refId);
    if (!abstractFormat) continue;
    out.push({ numId, abstractFormat });
  }

  return out;
}

// ---------- internals ----------

function readLevels(absEl: Element): NumberingLevel[] {
  const out: NumberingLevel[] = [];
  for (const lvlEl of wAll(absEl, "lvl")) {
    const ilvlStr =
      lvlEl.getAttributeNS(NS.w, "ilvl") ?? lvlEl.getAttribute("w:ilvl");
    if (!ilvlStr) continue;
    const ilvl = Number.parseInt(ilvlStr, 10);
    if (!Number.isFinite(ilvl)) continue;

    const numFmtRaw = wVal(wFirst(lvlEl, "numFmt"));
    let lvlText = wVal(wFirst(lvlEl, "lvlText")) ?? "";
    const restartStr = wVal(wFirst(lvlEl, "lvlRestart"));
    const restart = restartStr ? Number.parseInt(restartStr, 10) : undefined;

    const pPr = wFirst(lvlEl, "pPr");
    const paragraphIndent = pPr ? readIndent(pPr) : undefined;

    // Wingdings bullets: Word commonly encodes bullet glyphs as PUA
    // chars (U+F0xx) with `<w:rFonts w:ascii="Wingdings"/>` on the
    // level's rPr. Browsers rarely have Wingdings installed and even
    // when they do, the PUA codepoint renders as a missing-glyph
    // square. Map the common Wingdings → standard-Unicode equivalents
    // so the bullet shows up visually correct without needing the
    // Wingdings font (e.g. `` → "▪" U+25AA BLACK SMALL SQUARE).
    const rPr = wFirst(lvlEl, "rPr");
    const rFonts = rPr ? wFirst(rPr, "rFonts") : null;
    const fontAscii = rFonts?.getAttribute("w:ascii") ?? rFonts?.getAttribute("w:hAnsi") ?? "";
    if (fontAscii.toLowerCase().includes("wingdings") || fontAscii.toLowerCase().includes("symbol")) {
      lvlText = mapSymbolFontCodepoints(lvlText, fontAscii);
    }

    const level: NumberingLevel = {
      level: ilvl,
      format: numFmtRaw ?? "decimal",
      text: lvlText,
    };
    if (restart !== undefined && Number.isFinite(restart)) level.restart = restart;
    if (paragraphIndent) level.paragraphIndent = paragraphIndent;
    out.push(level);
  }
  return out;
}

function readIndent(pPr: Element): ParagraphIndent | undefined {
  const ind = wFirst(pPr, "ind");
  if (!ind) return undefined;
  const out: ParagraphIndent = {};
  const left = readTwips(ind, "left");
  if (left !== null) out.leftTwips = left;
  const right = readTwips(ind, "right");
  if (right !== null) out.rightTwips = right;
  const firstLine = readTwips(ind, "firstLine");
  if (firstLine !== null) out.firstLineTwips = firstLine;
  const hanging = readTwips(ind, "hanging");
  if (hanging !== null) out.hangingTwips = hanging;
  return Object.keys(out).length > 0 ? out : undefined;
}

function readTwips(el: Element, name: string): number | null {
  const v =
    el.getAttributeNS(NS.w, name) ?? el.getAttribute(`w:${name}`);
  if (v === null) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Translate Wingdings / Symbol PUA codepoints to their visual Unicode
 * equivalents so bullet markers render without needing the legacy
 * font installed.
 *
 * Word stores Wingdings glyphs as private-use characters in the
 * U+F000–U+F0FF range (codepoint = 0xF000 + glyph index). Browsers
 * either skip these (missing-glyph box) or, if Wingdings is somehow
 * available, render the correct shape — but bullet markers are
 * common enough that we just substitute the obvious ones.
 *
 * Only the bullets we've observed in real fixtures are mapped; an
 * unknown PUA char falls through unchanged so the renderer still
 * has a chance to draw something.
 */
function mapSymbolFontCodepoints(text: string, font: string): string {
  const isSymbol = font.toLowerCase().startsWith("symbol");
  return text.replace(/[-]/g, (ch) => {
    const cp = ch.charCodeAt(0);
    // Wingdings bullets — the lookup covers the markers that show up
    // in Word's built-in list templates (Office 365 + 2019+).
    const wingdings: Record<number, string> = {
      0xf06c: "●", // BLACK CIRCLE — large dot
      0xf06e: "■", // BLACK SQUARE — large filled square
      0xf0a7: "▪", // BLACK SMALL SQUARE — bullet style used by Google CV template
      0xf0a8: "□", // WHITE SQUARE
      0xf076: "❖", // BLACK DIAMOND MINUS WHITE X
      0xf0d8: "▶", // BLACK RIGHT-POINTING TRIANGLE
      0xf0d9: "▷",
      0xf0fc: "✓", // CHECK MARK
      0xf0fb: "✗", // BALLOT X
    };
    if (wingdings[cp]) return wingdings[cp]!;
    // Symbol font: U+F0B7 is the "•" bullet — same shape as U+2022.
    if (isSymbol && cp === 0xf0b7) return "•";
    return ch;
  });
}
