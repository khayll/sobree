/**
 * Emit `word/numbering.xml` from the document's numbering definitions.
 *
 * Without this part, every exported list paragraph's `<w:numPr>` points
 * at a `numId` that doesn't exist — Word silently renders the list as
 * plain paragraphs, so bullets/numbers were lost on EVERY exported
 * document that contained a list (the export-fixpoint audit measured
 * 20/20 corpus fixtures losing all numbering definitions).
 *
 * Sobree's `NumberingDefinition` is already flattened (each `numId`
 * carries its fully-resolved levels — `numStyleLink` indirection is
 * resolved at import), so the emission is direct: one `<w:abstractNum>`
 * per definition plus the `<w:num>` instance binding its `numId`.
 */

import { el, xmlDocument } from "../shared/xml";
import { NS } from "../shared/namespaces";
import type { NumberingDefinition, NumberingLevel } from "../../doc/types";

export function renderNumberingXml(
  numbering: readonly NumberingDefinition[],
): string | null {
  if (numbering.length === 0) return null;
  const abstracts = numbering.map((def, i) =>
    el(
      "w:abstractNum",
      { "w:abstractNumId": i },
      def.abstractFormat.levels.map(renderLevel),
    ),
  );
  const nums = numbering.map((def, i) =>
    el("w:num", { "w:numId": def.numId }, [
      el("w:abstractNumId", { "w:val": i }),
    ]),
  );
  return xmlDocument(
    el("w:numbering", { "xmlns:w": NS.w }, [...abstracts, ...nums]),
  );
}

function renderLevel(lvl: NumberingLevel): string {
  const children: string[] = [
    el("w:start", { "w:val": 1 }),
    el("w:numFmt", { "w:val": lvl.format }),
  ];
  if (lvl.restart !== undefined) {
    children.push(el("w:lvlRestart", { "w:val": lvl.restart }));
  }
  children.push(el("w:lvlText", { "w:val": lvl.text }));
  children.push(el("w:lvlJc", { "w:val": "left" }));
  const ind = lvl.paragraphIndent;
  if (ind) {
    children.push(
      el("w:pPr", null, [
        el("w:ind", {
          "w:left": ind.leftTwips,
          "w:right": ind.rightTwips,
          "w:firstLine": ind.firstLineTwips,
          "w:hanging": ind.hangingTwips,
        }),
      ]),
    );
  }
  const marker = lvl.runDefaults;
  if (marker && (marker.fontFamily || marker.color || marker.fontSizePt !== undefined)) {
    const rPr: string[] = [];
    if (marker.fontFamily) {
      rPr.push(el("w:rFonts", { "w:ascii": marker.fontFamily, "w:hAnsi": marker.fontFamily }));
    }
    if (marker.color) rPr.push(el("w:color", { "w:val": marker.color.replace(/^#/, "") }));
    if (marker.fontSizePt !== undefined) {
      rPr.push(el("w:sz", { "w:val": Math.round(marker.fontSizePt * 2) }));
    }
    children.push(el("w:rPr", null, rPr));
  }
  return el("w:lvl", { "w:ilvl": lvl.level }, children);
}
