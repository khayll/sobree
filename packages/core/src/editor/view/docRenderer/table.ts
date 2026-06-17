import {
  type TableCellPosition,
  resolveTableCellFormat,
  resolveTableStyle,
} from "../../../doc/tableStyle";
import type {
  Block,
  BorderSpec,
  NamedStyle,
  NumberingDefinition,
  Table,
  TableBorders,
  TableCell,
  TableCellBorders,
  TableCellMargins,
  TableLook,
  TableRow,
  TableStyleCellFormat,
  TableStyleDefinition,
} from "../../../doc/types";
import { twipsToMmExact } from "./units";

/**
 * Renderer for a table cell's block content, injected by the caller
 * (`block.ts`) instead of imported — so `table.ts` never imports
 * `block.ts`, breaking the block ↔ table render cycle. The recursion is
 * genuine (a cell holds blocks; a block may be a nested table), but the
 * *import* cycle isn't: the sole caller already owns `renderBlocks` and
 * hands it in.
 */
export type RenderCellBlocks = (
  blocks: readonly Block[],
  host: HTMLElement,
  numbering: readonly NumberingDefinition[],
  styles: readonly NamedStyle[],
  rawParts: Record<string, Uint8Array>,
) => void;

/**
 * Render a Table to a `<table>` element. `vMerge: "restart"` cells
 * emit with `rowspan=N` computed from the following `"continue"` cells
 * in the same column. `"continue"` cells render nothing — their column
 * is covered by the spanned restart cell above.
 *
 * `styles` + `numbering` thread through so each cell's paragraphs go
 * through the full cascade (line-height, spacing, alignment, font from
 * style). Without this, table-cell paragraphs would render flat
 * (visible bug: BodyText-styled paragraphs inside cells lost their
 * 1.5× line-height because the cell's own renderer ignored per-paragraph
 * properties).
 */
export function renderTable(
  table: Table,
  renderCellBlocks: RenderCellBlocks,
  numbering: readonly NumberingDefinition[] = [],
  styles: readonly NamedStyle[] = [],
  rawParts: Record<string, Uint8Array> = {},
): HTMLElement {
  const t = document.createElement("table");

  // Resolve the table style (`tblStyle` ref → merged definition) once.
  // Its base borders draw the grid (own `<w:tblBorders>` still wins);
  // its conditional formats colour rows / columns / corners per cell.
  const styleDef = resolveTableStyle(styles, table.properties.styleId);
  const effBorders = effectiveTableBorders(table, styleDef);
  applyTableFrame(t, effBorders);

  const cellCtx: CellStyleContext = {
    def: styleDef,
    look: table.properties.look ?? {},
    rowCount: table.rows.length,
    colCount: countColumns(table),
    borders: effBorders,
    margins: effectiveCellMargins(table, styleDef),
  };

  // Pre-compute rowspan per (row, col) for every restart cell.
  const rowSpans = computeRowSpans(table);

  const headRows = table.rows.map((r, i) => ({ r, i })).filter((x) => x.r.isHeader);
  const bodyRows = table.rows.map((r, i) => ({ r, i })).filter((x) => !x.r.isHeader);

  if (headRows.length > 0) {
    const thead = document.createElement("thead");
    for (const { r, i } of headRows) {
      thead.appendChild(
        renderRow(r, i, "th", rowSpans, cellCtx, numbering, styles, rawParts, renderCellBlocks),
      );
    }
    t.appendChild(thead);
  }
  if (bodyRows.length > 0) {
    const tbody = document.createElement("tbody");
    for (const { r, i } of bodyRows) {
      tbody.appendChild(
        renderRow(r, i, "td", rowSpans, cellCtx, numbering, styles, rawParts, renderCellBlocks),
      );
    }
    t.appendChild(tbody);
  }
  return t;
}

/** How many grid columns / rows a cell spans (`gridSpan` / `vMerge`). */
interface TableCellSpan {
  col: number;
  row: number;
}

/** Per-table style context shared by every cell render — the resolved
 *  style definition, the table's `<w:tblLook>`, the grid dimensions
 *  needed to place each cell for conditional-format resolution, and the
 *  effective table borders / cell margins. */
interface CellStyleContext {
  def: TableStyleDefinition | null;
  look: TableLook;
  rowCount: number;
  colCount: number;
  /** Effective table borders (own `<w:tblBorders>` ?? style base, plus
   *  the `TableGrid` default). Inside vs outer is resolved per cell. */
  borders: TableBorders | null;
  /** Effective default cell padding (instance `<w:tblCellMar>` ?? style),
   *  per side in twips. Absent sides fall back to Word's default. */
  margins: TableCellMargins | undefined;
}

function renderRow(
  row: TableRow,
  rowIndex: number,
  defaultCell: "th" | "td",
  rowSpans: Map<string, number>,
  cellCtx: CellStyleContext,
  numbering: readonly NumberingDefinition[],
  styles: readonly NamedStyle[],
  rawParts: Record<string, Uint8Array>,
  renderCellBlocks: RenderCellBlocks,
): HTMLElement {
  const tr = document.createElement("tr");
  let col = 0;
  for (const cell of row.cells) {
    const gridSpan = cell.gridSpan ?? 1;
    if (cell.vMerge === "continue") {
      col += gridSpan;
      continue; // occluded by the restart cell above
    }
    const pos: TableCellPosition = {
      rowIndex,
      colIndex: col,
      rowCount: cellCtx.rowCount,
      colCount: cellCtx.colCount,
    };
    const rowSpan = rowSpans.get(`${rowIndex}:${col}`) ?? 1;
    const el = renderCell(
      cell,
      defaultCell,
      cellCtx,
      pos,
      { col: gridSpan, row: rowSpan },
      numbering,
      styles,
      rawParts,
      renderCellBlocks,
    );
    if (gridSpan > 1) el.setAttribute("colspan", String(gridSpan));
    if (rowSpan > 1) el.setAttribute("rowspan", String(rowSpan));
    tr.appendChild(el);
    col += gridSpan;
  }
  return tr;
}

function renderCell(
  cell: TableCell,
  defaultTag: "th" | "td",
  cellCtx: CellStyleContext,
  pos: TableCellPosition,
  span: TableCellSpan,
  numbering: readonly NumberingDefinition[],
  styles: readonly NamedStyle[],
  rawParts: Record<string, Uint8Array>,
  renderCellBlocks: RenderCellBlocks,
): HTMLElement {
  const el = document.createElement(defaultTag);

  // Resolve the table style's conditional formatting for this cell
  // position (gold header / banded rows / corners). Direct cell
  // formatting below wins over it.
  const styleFmt: TableStyleCellFormat = cellCtx.def
    ? resolveTableCellFormat(cellCtx.def, cellCtx.look, pos)
    : {};

  // <w:shd w:fill="XXXXXX"/> on the cell — colour the cell background.
  // We render only the `fill` (most common case); patterned shading
  // (`pct10`, etc.) collapses to solid fill. A direct cell fill wins;
  // otherwise the resolved table-style fill applies.
  const fill =
    cell.shading?.fill && cell.shading.fill !== "#auto"
      ? cell.shading.fill
      : styleFmt.shading?.fill && styleFmt.shading.fill !== "#auto"
        ? styleFmt.shading.fill
        : undefined;
  if (fill) el.style.backgroundColor = fill;

  // Borders, resolved per edge so the table's INSIDE separators
  // (`insideH`/`insideV`) and its OUTER frame (top/right/bottom/left) stay
  // distinct — a style that declares only inside borders must NOT draw a
  // perimeter it never specified. Conditional-region borders and a cell's
  // own `<w:tcBorders>` override the base edge.
  applyCellBorders(el, {
    table: cellCtx.borders,
    pos,
    span,
    region: styleFmt.borders,
    direct: cell.borders,
  });

  // Cell padding from `<w:tblCellMar>` (instance ?? style). Word omits
  // top/bottom by default but commonly sets vertical padding on banded
  // tables; without it cells render cramped against the gridlines.
  applyCellPadding(el, cellCtx.margins);

  // <w:vAlign w:val="top|center|bottom"/> on the cell. CSS table-cell
  // vertical alignment is the `vertical-align` property on the <td>.
  if (cell.verticalAlign) {
    el.style.verticalAlign = cell.verticalAlign === "center" ? "middle" : cell.verticalAlign;
  }

  // Delegate paragraph / nested-table rendering to renderBlocks so each
  // cell child goes through the full cascade (line-height, spacing,
  // alignment, font from style). Without this, per-paragraph properties
  // are silently dropped inside table cells.
  if (cell.content.length > 0) {
    renderCellBlocks(cell.content, el, numbering, styles, rawParts);
    // Match LibreOffice's "compress paragraph after-spacing inside
    // table cells" rendering opinion. Word literally applies
    // `<w:spacing w:after>` in cells; LO ignores it for the implicit
    // 240-twip (4mm) default that most styles inherit. Result on
    // resume-style docs (complex-multipage.docx, healthcare-with-photo)
    // is that LO packs significantly more rows per page than Word /
    // Sobree-stock — which then forces Sobree to spend extra pages
    // for content that LO fits inline.
    //
    // The compression only affects paragraphs whose rendered margin
    // is the OOXML default (4mm); explicit non-default after-spacing
    // (e.g. 8mm, 12mm) is preserved as-authored. Paragraphs that the
    // renderer left WITHOUT an inline margin-bottom (because the
    // source said nothing) inherit the browser default via the CSS
    // selector in `paperStack.css` and get tightened there.
    tightenDefaultAfterSpacing(el);
  } else {
    // Word requires every cell to have at least one paragraph; supply
    // a single <br> so the cell renders with a caret target / minimum
    // height when the AST is empty.
    el.appendChild(document.createElement("br"));
  }
  return el;
}

/**
 * Walk a table cell's rendered paragraphs and zero out the
 * margin-bottom for any paragraph whose source carried the default
 * `<w:spacing w:after="240"/>` (≈ 4 mm). Word renders this literally;
 * LibreOffice ignores it inside table cells. We match LO so resume-
 * style multi-row cells pack to LO's page count rather than running
 * 1–2 pages longer.
 *
 * Custom non-default after-spacing (e.g. 8 mm, 12 mm — usually set
 * intentionally by the author for visual separation) is left alone;
 * removing it would be a more aggressive deviation from spec than
 * the LO heuristic justifies.
 */
function tightenDefaultAfterSpacing(cellEl: HTMLElement): void {
  for (const p of cellEl.querySelectorAll("p")) {
    if (!(p instanceof HTMLElement)) continue;
    const mb = p.style.marginBottom;
    // The renderer formats the value as `${twipsToMm(after)}mm`. The
    // OOXML default is 240 twips → 4mm. Match the exact rendered
    // string to avoid mis-tightening anything else (e.g. paragraphs
    // with explicit larger after-spacing render as "8mm" or "10mm").
    if (mb === "4mm") p.style.marginBottom = "0px";
    // Line-height tightening: Word's "Multiple 1.15" line-rule renders
    // as `line-height: ~1.20` (Calibri natural leading 1.05 × 1.15
    // multiplier). LO ignores this inside table cells, defaulting to
    // single-spacing. Tightening here unlocks the page-density win
    // needed to absorb the Operating Systems / Tech Proficiency
    // widow into the previous page. Line baselines shift slightly
    // vs LO's reference rendering, so the corpus drift score rises
    // — accepted as the cost of one-fewer-page convergence.
    const lh = p.style.lineHeight;
    if (lh && /^1\.(0[5-9]|1[0-9]|2[0-9])\d*$/.test(lh)) {
      p.style.lineHeight = "1";
    }
  }
}

/** Word's default `TableGrid` border — a thin auto-coloured line on every
 *  edge (outer + inside) when the style declares no explicit borders. */
const GRID_DEFAULT_BORDER: BorderSpec = { style: "single", sizeEighthsOfPt: 4, color: "auto" };

/**
 * Resolve the table's effective borders: the table's own `<w:tblBorders>`
 * wins; otherwise the resolved table style's base borders apply. A
 * declared-but-empty own `{}` is an explicit "no borders" and suppresses
 * the style's borders. A bare `tblStyle="TableGrid"` with nothing declared
 * gets the default full grid. Returns `null` when the table is borderless.
 */
function effectiveTableBorders(
  table: Table,
  styleDef: TableStyleDefinition | null,
): TableBorders | null {
  const own = table.properties.borders;
  const b = own !== undefined ? own : styleDef?.borders;
  const hasAnySide = !!(b && (b.top || b.right || b.bottom || b.left || b.insideH || b.insideV));
  if (hasAnySide) return b ?? null;
  // Explicit own-`{}` (declared but every side "none") → stay borderless,
  // even under TableGrid (the doc overrode the style on purpose).
  if (own !== undefined) return null;
  if (table.properties.styleId === "TableGrid") {
    return {
      top: GRID_DEFAULT_BORDER,
      right: GRID_DEFAULT_BORDER,
      bottom: GRID_DEFAULT_BORDER,
      left: GRID_DEFAULT_BORDER,
      insideH: GRID_DEFAULT_BORDER,
      insideV: GRID_DEFAULT_BORDER,
    };
  }
  return null;
}

/** Effective default cell padding — the instance `<w:tblCellMar>` wins
 *  per side over the style's. Returns `undefined` when neither sets any. */
function effectiveCellMargins(
  table: Table,
  styleDef: TableStyleDefinition | null,
): TableCellMargins | undefined {
  const own = table.properties.cellMargins;
  const style = styleDef?.cellMargins;
  if (!own && !style) return undefined;
  return { ...style, ...own };
}

/** Stamp the border-collapse + class needed for cell borders to merge
 *  cleanly. The borders themselves are drawn per cell (inside vs outer),
 *  not here — only the collapse mode and the padding-default class live
 *  on the `<table>`. */
function applyTableFrame(t: HTMLElement, borders: TableBorders | null): void {
  if (!borders) return;
  t.style.borderCollapse = "collapse";
  t.classList.add("sobree-table-bordered");
}

/** Everything needed to resolve one cell's four borders. */
interface CellBorderInputs {
  /** Effective table-level borders (inside + outer), or null if borderless. */
  table: TableBorders | null;
  /** The cell's grid placement — which edges are the table's perimeter. */
  pos: TableCellPosition;
  span: TableCellSpan;
  /** Conditional-region borders from the table style (override base edges). */
  region?: TableCellBorders | undefined;
  /** The cell's own `<w:tcBorders>` — direct formatting, wins over all. */
  direct?: TableCellBorders | undefined;
}

/**
 * Resolve and apply one cell's four borders. The base edge comes from the
 * table borders, split by position: an OUTER edge (the table's perimeter)
 * uses `top`/`right`/`bottom`/`left`; an INNER edge uses `insideH` (drawn
 * as the top of every non-first row) / `insideV` (the left of every
 * non-first column). This keeps an inside-only style from painting a
 * perimeter it never declared. Region borders, then the cell's own
 * `<w:tcBorders>`, override per side.
 */
function applyCellBorders(
  el: HTMLElement,
  { table, pos, span, region, direct }: CellBorderInputs,
): void {
  const atTop = pos.rowIndex === 0;
  const atLeft = pos.colIndex === 0;
  const atBottom = pos.rowIndex + span.row >= pos.rowCount;
  const atRight = pos.colIndex + span.col >= pos.colCount;

  const base: Record<"top" | "right" | "bottom" | "left", BorderSpec | undefined> = {
    // Inside-H is drawn once per shared edge as the lower row's top; the
    // upper row's bottom stays empty unless it's the table's bottom edge.
    top: table ? (atTop ? table.top : table.insideH) : undefined,
    bottom: table && atBottom ? table.bottom : undefined,
    left: table ? (atLeft ? table.left : table.insideV) : undefined,
    right: table && atRight ? table.right : undefined,
  };

  for (const side of ["top", "right", "bottom", "left"] as const) {
    const spec = direct?.[side] ?? region?.[side] ?? base[side];
    if (spec) el.style.setProperty(`border-${side}`, borderSpecToCss(spec));
  }
}

/** Apply default cell padding from `<w:tblCellMar>`. Word omits a side
 *  → fall back to its stock defaults (108 twips L/R, 0 T/B). Skipped
 *  entirely when no margins were declared, so plain tables keep the CSS
 *  default. */
function applyCellPadding(el: HTMLElement, margins: TableCellMargins | undefined): void {
  if (!margins) return;
  const top = margins.topTwips ?? 0;
  const right = margins.rightTwips ?? 108;
  const bottom = margins.bottomTwips ?? 0;
  const left = margins.leftTwips ?? 108;
  // Exact mm (not the integer-rounded `twipsToMm`) — cell padding is small
  // enough that rounding 2.54mm → 3mm visibly over-pads.
  const mm = (tw: number) => `${twipsToMmExact(tw).toFixed(2)}mm`;
  el.style.padding = `${mm(top)} ${mm(right)} ${mm(bottom)} ${mm(left)}`;
}

function borderSpecToCss(spec: { style: string; sizeEighthsOfPt: number; color: string }): string {
  // Word's `sz` is eighths of a point. 4 = 0.5pt ≈ 0.67px @ 96dpi.
  // Clamp to at least 1px so the border is visible on screen.
  const px = Math.max(1, Math.round((spec.sizeEighthsOfPt / 8) * (96 / 72)));
  // Map OOXML border styles → CSS `border-style` keywords. "single" /
  // "thick" / "wave" / unknown all collapse to `solid` — CSS doesn't
  // have wavy borders, and `single` isn't a valid CSS keyword.
  const style =
    spec.style === "double"
      ? "double"
      : spec.style === "dashed"
        ? "dashed"
        : spec.style === "dotted"
          ? "dotted"
          : spec.style === "none"
            ? "none"
            : "solid";
  const color = spec.color === "auto" ? "#888" : spec.color;
  return `${px}px ${style} ${color}`;
}

/** Maximum logical column count across all rows (accounting for
 *  `gridSpan`). Used to place each cell for conditional-format edges. */
function countColumns(table: Table): number {
  return table.rows.reduce(
    (n, r) =>
      Math.max(
        n,
        r.cells.reduce((s, c) => s + (c.gridSpan ?? 1), 0),
      ),
    0,
  );
}

/**
 * Walk the table: for each `(row, col)` that hosts a restart cell,
 * count how many following rows at that column carry a `"continue"`,
 * and store `rowspan = 1 + continue count`.
 */
function computeRowSpans(table: Table): Map<string, number> {
  const out = new Map<string, number>();
  // First pass: build a per-row, per-column view of cells.
  const grid: (TableCell | null)[][] = [];
  const maxCol = table.rows.reduce(
    (n, r) =>
      Math.max(
        n,
        r.cells.reduce((s, c) => s + (c.gridSpan ?? 1), 0),
      ),
    0,
  );
  for (const row of table.rows) {
    const cols: (TableCell | null)[] = new Array(maxCol).fill(null);
    let col = 0;
    for (const cell of row.cells) {
      const span = cell.gridSpan ?? 1;
      for (let k = 0; k < span; k++) cols[col + k] = cell;
      col += span;
    }
    grid.push(cols);
  }

  for (let rowIndex = 0; rowIndex < grid.length; rowIndex++) {
    const row = grid[rowIndex];
    if (!row) continue;
    for (let col = 0; col < row.length; col++) {
      const cell = row[col];
      if (!cell || cell.vMerge !== "restart") continue;
      // Only record on the first column the cell spans (left edge).
      if (col > 0 && row[col - 1] === cell) continue;
      let span = 1;
      for (let j = rowIndex + 1; j < grid.length; j++) {
        const below = grid[j]?.[col];
        if (below && below.vMerge === "continue") span += 1;
        else break;
      }
      out.set(`${rowIndex}:${col}`, span);
    }
  }
  return out;
}
