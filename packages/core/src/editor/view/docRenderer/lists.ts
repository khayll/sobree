/**
 * List rendering: turn a numbered/bulleted paragraph's numbering
 * definition into the right `<ol>` / `<ul>` container with correct
 * marker geometry and glyph.
 *
 * `paragraphListInfo` reads the numbering definition for a paragraph
 * (ordered vs bulleted, indent geometry, bullet glyph). `createListContainer`
 * builds the list element from that info. The caller (renderBlocks)
 * owns the grouping logic (consecutive same-`numId` paragraphs share
 * one container) and the per-`<li>` rendering — those need the
 * paragraph-level pipeline (props, runs, revision marks).
 */

import { twipsToMm } from "./units";
import type { Block, NumberingDefinition } from "../../../doc/types";

export interface ListInfo {
  numId: number;
  ordered: boolean;
  /** Effective left indent (text wrap position) for this list level,
   *  in twips — from the numbering definition's `<w:lvl><w:pPr><w:ind>`.
   *  Applied as `padding-left` on the OL / UL so wrapped text lands at
   *  the right position and the marker hangs to its left. */
  leftTwips?: number;
  /** Twips the FIRST line hangs to the left of `leftTwips` (= `@w:hanging`).
   *  The marker sits at `(leftTwips - hangingTwips)` from the content edge. */
  hangingTwips?: number;
  /** The level's lvlText glyph (post-Wingdings remapping), for bullets. */
  bulletGlyph?: string;
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
  const format = lvl?.format;
  const result: ListInfo = {
    numId: num.numId,
    ordered: format !== "bullet",
  };
  if (lvl?.paragraphIndent?.leftTwips !== undefined) {
    result.leftTwips = lvl.paragraphIndent.leftTwips;
  }
  if (lvl?.paragraphIndent?.hangingTwips !== undefined) {
    result.hangingTwips = lvl.paragraphIndent.hangingTwips;
  }
  if (format === "bullet" && lvl?.text) {
    result.bulletGlyph = lvl.text;
  }
  return result;
}

/**
 * Build the `<ol>` / `<ul>` container for a run of list items sharing
 * a `numId`. Sets marker geometry (padding-left + hanging custom
 * property) and bullet glyph (native CSS keyword where one exists,
 * else a `::marker`-content custom property).
 */
export function createListContainer(
  info: ListInfo,
  sectionIndex: number,
): HTMLElement {
  const listEl = document.createElement(info.ordered ? "ol" : "ul");
  listEl.dataset.sectionIndex = String(sectionIndex);
  // OOXML's `<w:ind w:left="X" w:hanging="Y"/>` on the numbering
  // level says:
  //   text starts at `left` twips from the content edge
  //   the marker hangs `hanging` twips to the LEFT of text
  // ⇒ marker x = (left - hanging) from the content edge.
  //
  // CSS list-style-position: outside puts the marker right at the
  // LI's content-box edge — which equals the UL's padding-left. So
  // setting `padding-left = (left - hanging)` puts the marker at the
  // right spot, and the `--sobree-list-hanging-mm` custom property (a
  // sitewide CSS rule consumes it) shifts the first line of text by
  // `hanging` to land at `left` total.
  if (info.leftTwips !== undefined) {
    const left = info.leftTwips;
    const hanging = info.hangingTwips ?? 0;
    const markerOffset = Math.max(0, left - hanging);
    listEl.style.paddingLeft = `${twipsToMm(markerOffset)}mm`;
    if (hanging > 0) {
      listEl.style.setProperty("--sobree-list-hanging-mm", `${twipsToMm(hanging)}mm`);
    }
  }
  // Bullet glyph from the numbering definition's `lvlText`. For glyphs
  // that map cleanly to a CSS list-style-type keyword (▪ → square,
  // • → disc, ○ → circle) we set the keyword so the browser draws the
  // native marker. For all OTHER glyphs (❖ ◆ ★ — Wingdings/Symbol
  // chars without a CSS equivalent), stamp the glyph as a custom
  // property; a sitewide `::marker` rule reads it as marker content.
  if (!info.ordered && info.bulletGlyph) {
    const cssKeyword = cssListStyleForGlyph(info.bulletGlyph);
    if (cssKeyword !== "fallback") {
      listEl.style.listStyleType = cssKeyword;
    } else {
      listEl.style.setProperty("--sobree-bullet-glyph", `"${info.bulletGlyph}"`);
      // Suppress the browser-default disc so the ::marker content shows alone.
      listEl.style.listStyleType = "none";
      listEl.classList.add("sobree-list-custom-bullet");
    }
  }
  return listEl;
}

/**
 * Map a bullet glyph to a CSS `list-style-type` keyword, or "fallback"
 * when no native keyword matches (caller uses a `::marker`-content
 * custom property instead).
 */
function cssListStyleForGlyph(glyph: string): string {
  if (!glyph) return "disc";
  const first = glyph[0]!;
  if (first === "▪" || first === "■") return "square";
  if (first === "○" || first === "◦") return "circle";
  if (first === "•" || first === "●" || first === "◉") return "disc";
  return "fallback";
}
