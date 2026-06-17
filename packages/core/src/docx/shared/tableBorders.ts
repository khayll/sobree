/**
 * Shared `<w:tblBorders>` / `<w:tcBorders>` / `<w:tblCellMar>` readers.
 *
 * Used by the table importer (a table's own `<w:tblPr>`) AND the
 * table-style parser (a `<w:style type="table">`'s base + conditional
 * formats), so the parsing lives in one place.
 */

import type { BorderSpec, TableBorders, TableCellBorders, TableCellMargins } from "../../doc/types";
import { wFirst } from "./xml";

const BORDER_STYLES = new Set(["single", "double", "dashed", "dotted", "thick", "none"]);

/** Parse one border side element (`<w:top>` / `<w:insideH>` / …). Returns
 *  `null` for an explicit no-border (`w:val="none"`/`"nil"`). */
function readBorderSide(child: Element): BorderSpec | null {
  const val = child.getAttribute("w:val") ?? "single";
  if (val === "none" || val === "nil") return null;
  const sz = child.getAttribute("w:sz");
  const color = child.getAttribute("w:color");
  return {
    style: BORDER_STYLES.has(val) ? (val as BorderSpec["style"]) : "single",
    sizeEighthsOfPt: sz ? Number(sz) : 4,
    color: color && color !== "auto" ? `#${color}` : "auto",
  };
}

/** Read `<w:tblBorders>` (outer edges + `insideH`/`insideV`). */
export function readTableBorders(el: Element): TableBorders | null {
  const out: TableBorders = {};
  for (const side of ["top", "left", "right", "bottom", "insideH", "insideV"] as const) {
    const child = wFirst(el, side);
    if (!child) continue;
    const spec = readBorderSide(child);
    if (spec) out[side] = spec;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Read `<w:tcBorders>` (a cell's four edges). */
export function readCellBorders(el: Element): TableCellBorders | null {
  const out: TableCellBorders = {};
  for (const side of ["top", "left", "right", "bottom"] as const) {
    const child = wFirst(el, side);
    if (!child) continue;
    const spec = readBorderSide(child);
    if (spec) out[side] = spec;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Read `<w:tblCellMar>` / `<w:tcMar>` — per-side cell padding in twips.
 *  Each side child (`<w:top>`, `<w:left>`, …) carries `w:w` (twips). */
export function readCellMargins(el: Element): TableCellMargins | null {
  const out: TableCellMargins = {};
  const sides = [
    ["top", "topTwips"],
    ["right", "rightTwips"],
    ["bottom", "bottomTwips"],
    ["left", "leftTwips"],
  ] as const;
  for (const [tag, key] of sides) {
    const child = wFirst(el, tag);
    if (!child) continue;
    const raw = child.getAttribute("w:w");
    if (raw === null) continue;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) out[key] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}
