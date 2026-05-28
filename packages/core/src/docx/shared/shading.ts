/**
 * Read a `<w:shd>` element into a `Shading` AST node.
 *
 * The `<w:shd>` element appears in three contexts in OOXML:
 *   - `<w:tcPr><w:shd>` — table-cell background
 *   - `<w:pPr><w:shd>` — paragraph background
 *   - `<w:rPr><w:shd>` — run background (rare)
 *
 * The attribute shape is identical across all three (`val`, `fill`,
 * `color`), so one reader covers them all. Returns `undefined` when
 * the element is missing or its `fill` is `auto`/missing (no visible
 * background to apply).
 */

import { wFirst, wVal } from "./xml";
import type { Shading } from "../../doc/types";

export function readShading(parent: Element): Shading | undefined {
  const shdEl = wFirst(parent, "shd");
  if (!shdEl) return undefined;
  const fillRaw =
    shdEl.getAttributeNS(shdEl.namespaceURI, "fill") ?? shdEl.getAttribute("w:fill");
  if (!fillRaw || fillRaw === "auto") return undefined;
  const pattern = wVal(shdEl) ?? "clear";
  const fill = fillRaw.startsWith("#") ? fillRaw : `#${fillRaw}`;
  const out: Shading = { pattern, fill };
  const colorRaw =
    shdEl.getAttributeNS(shdEl.namespaceURI, "color") ?? shdEl.getAttribute("w:color");
  if (colorRaw && colorRaw !== "auto") {
    out.color = colorRaw.startsWith("#") ? colorRaw : `#${colorRaw}`;
  }
  return out;
}
