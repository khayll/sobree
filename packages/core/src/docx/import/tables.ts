import type { Block, Table, TableCell, TableLook, TableRow } from "../../doc/types";
import { readShading } from "../shared/shading";
import { readCellBorders, readCellMargins, readTableBorders } from "../shared/tableBorders";
import { wChildren, wFirst, wVal } from "../shared/xml";
import { type ConvertContext, convertParagraph } from "./paragraph";

/**
 * Convert a `<w:tbl>` element into a native Table block. Handles:
 *   - Column widths from `<w:tblGrid>` (twips).
 *   - Horizontal merges via `<w:gridSpan>`.
 *   - Vertical merges via `<w:vMerge>` (restart / continue).
 *   - Header rows flagged with `<w:tblHeader/>` in `<w:trPr>`.
 *   - Cell vertical alignment via `<w:vAlign>`.
 *   - Cell content as a sequence of Blocks (paragraphs, nested tables).
 */
export function convertTable(tbl: Element, ctx: ConvertContext): Table {
  const grid = readGrid(tbl);
  const rows = wChildren(tbl, "tr").map((tr) => readRow(tr, ctx));
  const properties: Table["properties"] = {};
  const tblPr = wFirst(tbl, "tblPr");
  if (tblPr) {
    const styleId = wVal(wFirst(tblPr, "tblStyle"));
    if (styleId) properties.styleId = styleId;
    const tblBorders = wFirst(tblPr, "tblBorders");
    if (tblBorders) {
      // Always carry a borders object when the source declared
      // `<w:tblBorders>`, even if every side was `w:val="none"`. An
      // empty `borders: {}` signals "the doc explicitly said no
      // borders" so the renderer's TableGrid auto-border heuristic
      // doesn't add stale borders back. Without this distinction,
      // user-contract's name-fields table (TableGrid + explicit none-
      // borders) rendered with the TableGrid default border while LO
      // honoured the override.
      properties.borders = readTableBorders(tblBorders) ?? {};
    }
    const look = readTblLook(tblPr);
    if (look) properties.look = look;
    const cellMar = wFirst(tblPr, "tblCellMar");
    if (cellMar) {
      const margins = readCellMargins(cellMar);
      if (margins) properties.cellMargins = margins;
    }
  }
  return {
    kind: "table",
    grid,
    rows,
    properties,
  };
}

/**
 * Read `<w:tblLook>`. The bitmask `w:val` is the legacy form; Word also
 * writes the boolean attributes (`w:firstRow` etc.) which we prefer. A
 * flag is on when its attribute is "1"/"true" OR the corresponding
 * bitmask bit is set. `noHBand`/`noVBand` invert to `hBand`/`vBand`.
 */
function readTblLook(tblPr: Element): TableLook | null {
  const el = wFirst(tblPr, "tblLook");
  if (!el) return null;
  const bits = Number.parseInt(el.getAttribute("w:val") ?? "0", 16) || 0;
  const flag = (attr: string, bit: number): boolean => {
    const v = el.getAttribute(`w:${attr}`);
    if (v != null) return v === "1" || v === "true";
    return (bits & bit) !== 0;
  };
  const look: TableLook = {};
  if (flag("firstRow", 0x0020)) look.firstRow = true;
  if (flag("lastRow", 0x0040)) look.lastRow = true;
  if (flag("firstColumn", 0x0080)) look.firstColumn = true;
  if (flag("lastColumn", 0x0100)) look.lastColumn = true;
  // The bitmask uses NO-band bits (0x0200 = noHBand, 0x0400 = noVBand);
  // banding is on when that bit is CLEAR. The boolean attrs are also
  // `noHBand`/`noVBand`, so read + invert.
  if (!flag("noHBand", 0x0200)) look.hBand = true;
  if (!flag("noVBand", 0x0400)) look.vBand = true;
  return look;
}

function readGrid(tbl: Element): number[] {
  const gridEl = wFirst(tbl, "tblGrid");
  if (!gridEl) return [];
  const cols = wChildren(gridEl, "gridCol");
  return cols.map((c) => {
    const raw = c.getAttribute("w:w") ?? "2400";
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 2400;
  });
}

function readRow(tr: Element, ctx: ConvertContext): TableRow {
  const trPr = wFirst(tr, "trPr");
  const isHeader = trPr ? wFirst(trPr, "tblHeader") !== null : false;
  const cells = wChildren(tr, "tc").map((tc) => readCell(tc, ctx));
  const row: TableRow = { cells };
  if (isHeader) row.isHeader = true;
  return row;
}

function readCell(tc: Element, ctx: ConvertContext): TableCell {
  const tcPr = wFirst(tc, "tcPr");
  const cell: TableCell = { content: [] };

  if (tcPr) {
    const gridSpanEl = wFirst(tcPr, "gridSpan");
    const gridSpan = wVal(gridSpanEl);
    if (gridSpan) {
      const n = Number(gridSpan);
      if (Number.isFinite(n) && n > 1) cell.gridSpan = n;
    }
    const vMergeEl = wFirst(tcPr, "vMerge");
    if (vMergeEl) {
      // `<w:vMerge/>` with no val means "continue". `w:val="restart"` begins
      // a new merge region.
      const val = wVal(vMergeEl);
      cell.vMerge = val === "restart" ? "restart" : "continue";
    }
    const vAlignVal = wVal(wFirst(tcPr, "vAlign"));
    if (vAlignVal === "top" || vAlignVal === "center" || vAlignVal === "bottom") {
      cell.verticalAlign = vAlignVal;
    }
    // <w:shd w:val="clear" w:fill="C6EFCE"/> — cell background colour.
    const cellShading = readShading(tcPr);
    if (cellShading) cell.shading = cellShading;
    // <w:tcBorders> — per-cell edge overrides (win over table/style).
    const tcBorders = wFirst(tcPr, "tcBorders");
    if (tcBorders) {
      const borders = readCellBorders(tcBorders);
      if (borders) cell.borders = borders;
    }
  }

  // Cell content: every direct child `<w:p>` or `<w:tbl>` becomes a Block.
  for (const child of Array.from(tc.children)) {
    if (child.namespaceURI === null) continue;
    if (child.localName === "p") {
      // A host paragraph whose drawing became an InlineFrame is replaced
      // wholesale — same contract as the body walker (the drawing has
      // already been claimed out of the XML, so converting the source
      // paragraph would render an empty husk and drop the frame).
      const replacement = ctx.replaceParagraphs?.get(child);
      cell.content.push(replacement ?? convertParagraph(child, ctx));
    } else if (child.localName === "tbl") {
      cell.content.push(convertTable(child, ctx));
    }
    // pPr/tcPr/etc. are handled above; other elements are dropped.
  }

  // Word requires at least one paragraph per cell. If Phase N2 flattened
  // something weird and left us empty, supply a blank paragraph so the
  // cell renders with a caret target.
  if (cell.content.length === 0) {
    const empty: Block = { kind: "paragraph", properties: {}, runs: [] };
    cell.content.push(empty);
  }

  return cell;
}
