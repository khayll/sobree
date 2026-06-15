/**
 * List rendering: turn a numbered/bulleted paragraph's numbering
 * definition into the right `<ol>` / `<ul>` container with a faithful
 * hanging marker.
 *
 * `paragraphListInfo` reads the numbering definition for a paragraph
 * (ordered vs bulleted, indent geometry, marker glyph/format).
 * `createListContainer` builds the list element. The caller
 * (renderBlocks) owns the grouping logic (consecutive same-`numId`
 * paragraphs share one container) and the per-`<li>` rendering.
 *
 * ## Hanging geometry (the load-bearing bit)
 *
 * Word's `<w:lvl><w:pPr><w:ind w:left="L" w:hanging="H"/>` means: the
 * text column (first line AND wraps) is at `L`, and the marker hangs `H`
 * to its left, i.e. the marker sits at `L - H`. Native CSS markers
 * (`list-style-position: outside`) hang by the marker's own glyph width,
 * NOT by `H`, so they can't reproduce this. We instead render the marker
 * as a fixed-`H`-wide `::before` box pulled left by `H` (see
 * paperStack.css): the box spans `[L - H, L]`, the glyph sits at its left
 * edge (`L - H`), and the text starts at `L`. Ordered markers read the
 * native `list-item` counter (so `<ol start>` continuation across page
 * splits keeps working) through a per-format CSS rule.
 */

import type { Block, NumberingDefinition } from "../../../doc/types";
import { resolveFontFace } from "./fontFallback";
import { twipsToMm } from "./units";

export interface ListInfo {
  numId: number;
  ordered: boolean;
  /** Text-column indent (`<w:ind w:left>`), twips → the OL/UL
   *  `padding-left`. First line and wraps both align here. */
  leftTwips?: number;
  /** Marker hang (`<w:ind w:hanging>`), twips → the width of the
   *  `::before` marker box; the marker sits at `leftTwips - hangingTwips`. */
  hangingTwips?: number;
  /** Bullet glyph (post-Wingdings remapping), for unordered lists. */
  bulletGlyph?: string;
  /** Marker glyph's own run formatting (`<w:lvl><w:rPr>`): colour, font,
   *  size. The font also matters for layout — Word lets the marker
   *  font's strut set the bullet line height (see paperStack.css). */
  markerColor?: string;
  markerFont?: string;
  markerSizePt?: number;
  /** CSS counter-style class suffix for ordered lists (`decimal`,
   *  `lower-latin`, …) — selects the matching `::before` rule. */
  counterStyle?: string;
  /** Literal text around the number in `lvlText` (`%1.` → suffix `.`;
   *  `(%1)` → prefix `(`, suffix `)`). */
  markerPrefix?: string;
  markerSuffix?: string;
}

/**
 * Resolve a paragraph's list membership from the numbering table.
 * Returns `null` for non-list paragraphs (no `numbering` property or
 * a `numId` not present in `numbering`).
 */
export function paragraphListInfo(
  block: Block,
  numbering: readonly NumberingDefinition[],
): ListInfo | null {
  if (block.kind !== "paragraph") return null;
  const num = block.properties.numbering;
  if (!num) return null;
  const def = numbering.find((n) => n.numId === num.numId);
  const lvl = def?.abstractFormat.levels[num.level];
  // The CONTAINER is anchored at level 0 (its padding-left is the level-0
  // text column; `applyListItemLevel` shifts deeper items). Anchoring it
  // at whatever level the group's FIRST paragraph happens to be would
  // mis-indent every other level in the group.
  const lvl0 = def?.abstractFormat.levels[0] ?? lvl;
  const format = lvl?.format;
  const result: ListInfo = {
    numId: num.numId,
    ordered: format !== "bullet",
  };
  if (lvl0?.paragraphIndent?.leftTwips !== undefined) {
    result.leftTwips = lvl0.paragraphIndent.leftTwips;
  }
  if (lvl0?.paragraphIndent?.hangingTwips !== undefined) {
    result.hangingTwips = lvl0.paragraphIndent.hangingTwips;
  }
  if (result.ordered) {
    result.counterStyle = counterStyleFor(format);
    const { prefix, suffix } = parseLvlText(lvl?.text ?? "", num.level);
    result.markerPrefix = prefix;
    result.markerSuffix = suffix;
  } else if (lvl0?.text) {
    result.bulletGlyph = lvl0.text;
  }
  const marker = lvl0?.runDefaults;
  if (marker?.color) result.markerColor = marker.color;
  if (marker?.fontFamily) result.markerFont = marker.fontFamily;
  if (marker?.fontSizePt !== undefined) result.markerSizePt = marker.fontSizePt;
  return result;
}

/**
 * Build the `<ol>` / `<ul>` container for a run of list items sharing a
 * `numId`. Sets the text-column `padding-left`, the `--sobree-list-hang`
 * marker-box width, and the marker content (glyph or counter format) the
 * CSS `::before` rules consume.
 */
export function createListContainer(info: ListInfo, sectionIndex: number): HTMLElement {
  const listEl = document.createElement(info.ordered ? "ol" : "ul");
  listEl.dataset.sectionIndex = String(sectionIndex);
  listEl.classList.add("sobree-hang");

  if (info.leftTwips !== undefined) {
    listEl.style.paddingLeft = `${twipsToMm(info.leftTwips)}mm`;
  }
  // The marker box width = hanging. Even with no explicit hanging we
  // give it a tiny gap so the marker doesn't collide with the text.
  const hangingMm = twipsToMm(info.hangingTwips ?? 0);
  listEl.style.setProperty("--sobree-list-hang", `${hangingMm}mm`);

  if (info.ordered) {
    listEl.classList.add(`lst-${info.counterStyle ?? "decimal"}`);
    listEl.style.setProperty("--mk-pre", cssString(info.markerPrefix ?? ""));
    listEl.style.setProperty("--mk-suf", cssString(info.markerSuffix ?? "."));
  } else {
    listEl.classList.add("lst-bullet");
    listEl.style.setProperty("--sobree-bullet", cssString(info.bulletGlyph ?? "•"));
  }
  // Marker glyph formatting (the `::before` rules consume these). The
  // font is deliberately carried even when the host may not ship it —
  // when it DOES resolve, the marker's strut opens up the bullet line
  // height exactly as Word lays it out.
  if (info.markerColor) listEl.style.setProperty("--sobree-marker-color", info.markerColor);
  if (info.markerFont) {
    listEl.style.setProperty("--sobree-marker-font", resolveFontFace(info.markerFont).stack);
  }
  if (info.markerSizePt !== undefined) {
    listEl.style.setProperty("--sobree-marker-size", `${info.markerSizePt}pt`);
  }
  return listEl;
}

/**
 * Apply a list item's OWN level styling. The shared container carries
 * level-0 geometry and marker; an item at a deeper `ilvl` overrides per
 * LI: extra indent (its level's text column relative to level 0), its
 * marker-box width, glyph, and marker run formatting — CSS custom props
 * set on the LI shadow the container's for this item's `::before`.
 * Ordered sub-levels keep the container's counter (a flat `list-item`
 * counter can't express per-level numbering — known limitation).
 */
export function applyListItemLevel(
  li: HTMLElement,
  block: Block,
  numbering: readonly NumberingDefinition[],
): void {
  if (block.kind !== "paragraph") return;
  const num = block.properties.numbering;
  if (!num || num.level === 0) return;
  const def = numbering.find((n) => n.numId === num.numId);
  const lvl = def?.abstractFormat.levels[num.level];
  const lvl0 = def?.abstractFormat.levels[0];
  if (!lvl) return;
  const dLeft = (lvl.paragraphIndent?.leftTwips ?? 0) - (lvl0?.paragraphIndent?.leftTwips ?? 0);
  if (dLeft > 0) li.style.marginLeft = `${twipsToMm(dLeft)}mm`;
  if (lvl.paragraphIndent?.hangingTwips !== undefined) {
    li.style.setProperty("--sobree-list-hang", `${twipsToMm(lvl.paragraphIndent.hangingTwips)}mm`);
  }
  if (lvl.format === "bullet" && lvl.text) {
    li.style.setProperty("--sobree-bullet", cssString(lvl.text));
  }
  const marker = lvl.runDefaults;
  if (marker?.color) li.style.setProperty("--sobree-marker-color", marker.color);
  if (marker?.fontFamily) {
    li.style.setProperty("--sobree-marker-font", resolveFontFace(marker.fontFamily).stack);
  }
  if (marker?.fontSizePt !== undefined) {
    li.style.setProperty("--sobree-marker-size", `${marker.fontSizePt}pt`);
  }
}

/** Map an OOXML `numFmt` to the CSS `<counter-style>` class suffix used
 *  by the `.lst-*` `::before` rules. Unknown formats fall back to
 *  decimal (Word's own default for unrecognised list formats). */
function counterStyleFor(format: string | undefined): string {
  switch (format) {
    case "lowerLetter":
      return "lower-latin";
    case "upperLetter":
      return "upper-latin";
    case "lowerRoman":
      return "lower-roman";
    case "upperRoman":
      return "upper-roman";
    case "decimalZero":
      return "decimal-zero";
    default:
      return "decimal";
  }
}

/**
 * Split a level's `lvlText` into the literal text before / after the
 * level's own number placeholder (`%{level+1}`). `%1.` → `{prefix:"",
 * suffix:"."}`; `(%1)` → `{prefix:"(", suffix:")"}`. Other levels'
 * placeholders (nested numbering, `%1.%2.`) are stripped — we render a
 * single level's marker, matching the prior native-`<ol>` behaviour.
 */
function parseLvlText(text: string, level: number): { prefix: string; suffix: string } {
  const token = `%${level + 1}`;
  const i = text.indexOf(token);
  const strip = (s: string): string => s.replace(/%\d+/g, "");
  if (i === -1) return { prefix: "", suffix: text ? strip(text) : "." };
  return { prefix: strip(text.slice(0, i)), suffix: strip(text.slice(i + token.length)) };
}

/** Quote a value as a CSS string for a custom property, escaping `\` and `"`. */
function cssString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
