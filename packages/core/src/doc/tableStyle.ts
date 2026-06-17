/**
 * Table-style resolution — turns a table's `tblStyle` reference + its
 * `<w:tblLook>` into the concrete formatting a single cell should get.
 *
 * Two stages:
 *   1. {@link resolveTableStyle} merges a table style up its `basedOn`
 *      chain into one {@link TableStyleDefinition} (base borders /
 *      shading / band sizes + per-region conditional formats).
 *   2. {@link resolveTableCellFormat} layers the conditional formats for
 *      one cell position, gated by the table's `look`, in ECMA-376
 *      §17.7.6 precedence order (low→high): wholeTable base → column
 *      banding → row banding → first/last column → first/last row →
 *      corner cells. Direct cell formatting (a cell's own `<w:shd>` /
 *      `<w:tcBorders>`) wins over all of this and is applied by the
 *      renderer, not here.
 *
 * Base whole-table BORDERS are intentionally NOT returned per cell — the
 * renderer applies them once at the `<table>` level (grid lines via CSS)
 * so paginated row clones inherit them. Only conditional-format border
 * overrides come back here, to layer on top of that grid.
 */

import type {
  NamedStyle,
  Shading,
  TableConditionalType,
  TableLook,
  TableStyleCellFormat,
  TableStyleDefinition,
} from "./types";

/** Logical position of a cell within its table (left/top edge of the
 *  cell when it spans multiple grid columns / rows). */
export interface TableCellPosition {
  rowIndex: number;
  colIndex: number;
  rowCount: number;
  colCount: number;
}

/**
 * Merge a table style up its `basedOn` chain into one definition. Base
 * ancestor first, the named style last so it wins. Sub-objects merge
 * field-by-field (a child that sets only `firstRow` keeps the parent's
 * `band1Horz`). Returns `null` if the style id is unknown or carries no
 * table formatting.
 */
export function resolveTableStyle(
  styles: readonly NamedStyle[],
  styleId: string | undefined,
): TableStyleDefinition | null {
  if (!styleId) return null;
  const chain: TableStyleDefinition[] = [];
  const seen = new Set<string>();
  let id: string | undefined = styleId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const s = styles.find((x) => x.id === id);
    if (!s) break;
    if (s.tableStyle) chain.push(s.tableStyle);
    id = s.basedOn;
  }
  if (chain.length === 0) return null;

  // Merge base-first (deepest ancestor) → leaf last.
  const out: TableStyleDefinition = {};
  for (let i = chain.length - 1; i >= 0; i--) {
    const def = chain[i];
    if (!def) continue;
    if (def.borders) out.borders = { ...out.borders, ...def.borders };
    if (def.shading) out.shading = def.shading;
    if (def.rowBandSize !== undefined) out.rowBandSize = def.rowBandSize;
    if (def.colBandSize !== undefined) out.colBandSize = def.colBandSize;
    if (def.cellMargins) out.cellMargins = { ...out.cellMargins, ...def.cellMargins };
    if (def.conditional) {
      out.conditional = { ...out.conditional };
      for (const [k, v] of Object.entries(def.conditional)) {
        const key = k as TableConditionalType;
        out.conditional[key] = { ...out.conditional[key], ...v };
      }
    }
  }
  return out;
}

/**
 * Resolve the conditional cell formatting (shading + per-side border
 * overrides) for one cell, gated by the table's `look`. Base whole-table
 * borders are NOT included (the renderer draws those at table level);
 * base shading IS, since nothing else applies it.
 */
export function resolveTableCellFormat(
  def: TableStyleDefinition,
  look: TableLook,
  pos: TableCellPosition,
): TableStyleCellFormat {
  const cond = def.conditional ?? {};
  // Collect the active region formats in precedence order (low → high).
  const layers: (TableStyleCellFormat | undefined)[] = [];

  // 0. Whole-table base shading (borders handled at table level).
  if (def.shading) layers.push({ shading: def.shading });

  const lastRow = pos.rowCount - 1;
  const lastCol = pos.colCount - 1;
  const atFirstRow = look.firstRow === true && pos.rowIndex === 0;
  const atLastRow = look.lastRow === true && pos.rowIndex === lastRow;
  const atFirstCol = look.firstColumn === true && pos.colIndex === 0;
  const atLastCol = look.lastColumn === true && pos.colIndex === lastCol;

  // 1. Column (vertical) banding — excludes the first/last column when
  //    those conditional formats own them.
  if (look.vBand && !atFirstCol && !atLastCol) {
    const lo = look.firstColumn ? 1 : 0;
    const hi = look.lastColumn ? lastCol - 1 : lastCol;
    const band = bandOf(pos.colIndex, lo, hi, def.colBandSize ?? 1);
    if (band) layers.push(cond[band === 1 ? "band1Vert" : "band2Vert"]);
  }
  // 2. Row (horizontal) banding — excludes the first/last row similarly.
  if (look.hBand && !atFirstRow && !atLastRow) {
    const lo = look.firstRow ? 1 : 0;
    const hi = look.lastRow ? lastRow - 1 : lastRow;
    const band = bandOf(pos.rowIndex, lo, hi, def.rowBandSize ?? 1);
    if (band) layers.push(cond[band === 1 ? "band1Horz" : "band2Horz"]);
  }
  // 3. First / last column.
  if (atFirstCol) layers.push(cond.firstCol);
  if (atLastCol) layers.push(cond.lastCol);
  // 4. First / last row (outrank columns).
  if (atFirstRow) layers.push(cond.firstRow);
  if (atLastRow) layers.push(cond.lastRow);
  // 5. Corner cells (highest precedence).
  if (atFirstRow && atFirstCol) layers.push(cond.nwCell);
  if (atFirstRow && atLastCol) layers.push(cond.neCell);
  if (atLastRow && atFirstCol) layers.push(cond.swCell);
  if (atLastRow && atLastCol) layers.push(cond.seCell);

  // Merge: last-defined shading wins; borders merge per side.
  let shading: Shading | undefined;
  let borders: TableStyleCellFormat["borders"];
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.shading) shading = layer.shading;
    if (layer.borders) borders = { ...borders, ...layer.borders };
  }
  const out: TableStyleCellFormat = {};
  if (shading) out.shading = shading;
  if (borders) out.borders = borders;
  return out;
}

/**
 * Which band an index falls in within `[lo, hi]`, given a band size.
 * Returns 1 for the first band (band1), 2 for the second (band2),
 * alternating. Returns `null` when the index is outside the banded
 * range. ECMA numbers the first band "1" (band1) and alternates.
 */
function bandOf(index: number, lo: number, hi: number, size: number): 1 | 2 | null {
  if (index < lo || index > hi) return null;
  const step = size > 0 ? size : 1;
  const bandNumber = Math.floor((index - lo) / step);
  return bandNumber % 2 === 0 ? 1 : 2;
}
