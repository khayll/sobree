/**
 * Read a `<w:shd>` element into a `Shading` AST node.
 *
 * The `<w:shd>` element appears in three contexts in OOXML:
 *   - `<w:tcPr><w:shd>` — table-cell background
 *   - `<w:pPr><w:shd>` — paragraph background
 *   - `<w:rPr><w:shd>` — run background (rare)
 *
 * The attribute shape is identical across all three (`val`, `fill`,
 * `color`), so one reader covers them all. Returns `undefined` only for a
 * truly invisible shd: a `clear`/`nil` pattern over an `auto` fill paints
 * nothing. A PATTERN (`pctN`, `solid`, stripes) stays even when both
 * colours are `auto`, because the foreground shows over the background —
 * `pct40 auto auto` is a ~40% grey divider. The effective display colour
 * is composited at render time (`resolveShadingColor`); the AST keeps
 * `pattern` + `fill` + `color` faithfully (auto included) for export.
 */

import type { Shading } from "../../doc/types";
import { wFirst, wVal } from "./xml";

export function readShading(parent: Element): Shading | undefined {
  const shdEl = wFirst(parent, "shd");
  if (!shdEl) return undefined;
  const pattern = wVal(shdEl) ?? "clear";
  const fillRaw = shdEl.getAttributeNS(shdEl.namespaceURI, "fill") ?? shdEl.getAttribute("w:fill");
  const colorRaw =
    shdEl.getAttributeNS(shdEl.namespaceURI, "color") ?? shdEl.getAttribute("w:color");
  const fillAuto = !fillRaw || fillRaw === "auto";
  const isClear = pattern === "clear" || pattern === "nil" || pattern === "none";
  const isSolid = pattern === "solid";
  // `clear`/`nil` over an auto fill is invisible; a pattern is not.
  if (fillAuto && isClear) return undefined;
  const fill = fillAuto ? "auto" : fillRaw.startsWith("#") ? fillRaw : `#${fillRaw}`;
  const out: Shading = { pattern, fill };
  // Keep the foreground for COMPOSITING patterns (pctN / stripes) that
  // blend it over the fill. An explicit hex is stored as-is; an `auto`
  // foreground under such a pattern is kept as "auto" (resolves to
  // text-black) so the composite is reproducible. `clear` ignores the
  // foreground and `solid` shows the fill, so neither needs it.
  if (colorRaw && colorRaw !== "auto") {
    out.color = colorRaw.startsWith("#") ? colorRaw : `#${colorRaw}`;
  } else if (!isClear && !isSolid) {
    out.color = "auto";
  }
  return out;
}
