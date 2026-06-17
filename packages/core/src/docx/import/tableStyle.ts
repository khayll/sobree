/**
 * Parse a `<w:style w:type="table">` into a {@link TableStyleDefinition}.
 *
 * A table style carries:
 *   - A whole-table base (`<w:tblPr>` borders + band sizes, `<w:tcPr>`
 *     shading) — the formatting every cell starts from.
 *   - Per-region conditional formats (`<w:tblStylePr w:type="firstRow|
 *     band1Horz|…">`) each with their own `<w:tcPr>` (shd fill +
 *     tcBorders). These layer on per cell when the table's `<w:tblLook>`
 *     enables them — see `doc/tableStyle.ts` for the resolver.
 *
 * The `w:type="wholeTable"` `<w:tblStylePr>` (rare — most styles put the
 * base directly on the style's own `<w:tblPr>`/`<w:tcPr>`) is folded into
 * the base too, so both spellings work.
 */

import type {
  TableConditionalType,
  TableStyleCellFormat,
  TableStyleDefinition,
} from "../../doc/types";
import { readShading } from "../shared/shading";
import { readCellBorders, readCellMargins, readTableBorders } from "../shared/tableBorders";
import { wFirst, wVal } from "../shared/xml";

/** OOXML `<w:tblStylePr w:type>` value → our {@link TableConditionalType}. */
const COND_TYPE: Record<string, TableConditionalType> = {
  firstRow: "firstRow",
  lastRow: "lastRow",
  firstCol: "firstCol",
  lastCol: "lastCol",
  band1Horz: "band1Horz",
  band2Horz: "band2Horz",
  band1Vert: "band1Vert",
  band2Vert: "band2Vert",
  nwCell: "nwCell",
  neCell: "neCell",
  swCell: "swCell",
  seCell: "seCell",
};

/** Read the cell formatting (shd fill + tcBorders) out of a `<w:tcPr>`. */
function readCellFormat(tcPr: Element | null): TableStyleCellFormat | null {
  if (!tcPr) return null;
  const out: TableStyleCellFormat = {};
  const shading = readShading(tcPr);
  if (shading) out.shading = shading;
  const tcBorders = wFirst(tcPr, "tcBorders");
  if (tcBorders) {
    const borders = readCellBorders(tcBorders);
    if (borders) out.borders = borders;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Parse a table-style `<w:style>` element into a TableStyleDefinition, or
 * `null` if it carries no table-specific formatting worth keeping.
 */
export function readTableStyle(styleEl: Element): TableStyleDefinition | null {
  const def: TableStyleDefinition = {};

  // --- Whole-table base from the style's own tblPr / tcPr ---
  const tblPr = wFirst(styleEl, "tblPr");
  if (tblPr) {
    const tblBorders = wFirst(tblPr, "tblBorders");
    if (tblBorders) {
      const borders = readTableBorders(tblBorders);
      if (borders) def.borders = borders;
    }
    const rowBand = wVal(wFirst(tblPr, "tblStyleRowBandSize"));
    if (rowBand) {
      const n = Number.parseInt(rowBand, 10);
      if (Number.isFinite(n) && n > 0) def.rowBandSize = n;
    }
    const colBand = wVal(wFirst(tblPr, "tblStyleColBandSize"));
    if (colBand) {
      const n = Number.parseInt(colBand, 10);
      if (Number.isFinite(n) && n > 0) def.colBandSize = n;
    }
    const cellMar = wFirst(tblPr, "tblCellMar");
    if (cellMar) {
      const margins = readCellMargins(cellMar);
      if (margins) def.cellMargins = margins;
    }
  }
  // The style's direct <w:tcPr> is the whole-table base cell shading.
  const baseFmt = readCellFormat(wFirst(styleEl, "tcPr"));
  if (baseFmt?.shading) def.shading = baseFmt.shading;

  // --- Conditional formats (`<w:tblStylePr>`) ---
  const conditional: Partial<Record<TableConditionalType, TableStyleCellFormat>> = {};
  for (const stylePr of childTblStylePr(styleEl)) {
    const typeAttr = stylePr.getAttribute("w:type");
    if (!typeAttr) continue;
    const fmt = readCellFormat(wFirst(stylePr, "tcPr"));
    if (!fmt) continue;
    if (typeAttr === "wholeTable") {
      // Fold a wholeTable conditional into the base (alternative spelling
      // — most styles use the style's own tblPr/tcPr instead). Only the
      // four outer sides map onto table borders; insideH/insideV aren't
      // expressible on a cell format.
      if (fmt.shading && !def.shading) def.shading = fmt.shading;
      if (fmt.borders && !def.borders) def.borders = { ...fmt.borders };
      continue;
    }
    const mapped = COND_TYPE[typeAttr];
    if (mapped) conditional[mapped] = fmt;
  }
  if (Object.keys(conditional).length > 0) def.conditional = conditional;

  return Object.keys(def).length > 0 ? def : null;
}

/** Direct-child `<w:tblStylePr>` elements (namespace-agnostic). */
function childTblStylePr(styleEl: Element): Element[] {
  return Array.from(styleEl.children).filter((c) => c.localName === "tblStylePr");
}
