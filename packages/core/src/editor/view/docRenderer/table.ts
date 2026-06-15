import type {
  Block,
  NamedStyle,
  NumberingDefinition,
  Table,
  TableCell,
  TableRow,
} from "../../../doc/types";

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
  applyTableBorders(t, table);

  // Pre-compute rowspan per (row, col) for every restart cell.
  const rowSpans = computeRowSpans(table);

  const headRows = table.rows.map((r, i) => ({ r, i })).filter((x) => x.r.isHeader);
  const bodyRows = table.rows.map((r, i) => ({ r, i })).filter((x) => !x.r.isHeader);

  if (headRows.length > 0) {
    const thead = document.createElement("thead");
    for (const { r, i } of headRows) {
      thead.appendChild(
        renderRow(r, i, "th", rowSpans, numbering, styles, rawParts, renderCellBlocks),
      );
    }
    t.appendChild(thead);
  }
  if (bodyRows.length > 0) {
    const tbody = document.createElement("tbody");
    for (const { r, i } of bodyRows) {
      tbody.appendChild(
        renderRow(r, i, "td", rowSpans, numbering, styles, rawParts, renderCellBlocks),
      );
    }
    t.appendChild(tbody);
  }
  return t;
}

function renderRow(
  row: TableRow,
  rowIndex: number,
  defaultCell: "th" | "td",
  rowSpans: Map<string, number>,
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
    const el = renderCell(cell, defaultCell, numbering, styles, rawParts, renderCellBlocks);
    if (gridSpan > 1) el.setAttribute("colspan", String(gridSpan));
    const rs = rowSpans.get(`${rowIndex}:${col}`);
    if (rs && rs > 1) el.setAttribute("rowspan", String(rs));
    tr.appendChild(el);
    col += gridSpan;
  }
  return tr;
}

function renderCell(
  cell: TableCell,
  defaultTag: "th" | "td",
  numbering: readonly NumberingDefinition[],
  styles: readonly NamedStyle[],
  rawParts: Record<string, Uint8Array>,
  renderCellBlocks: RenderCellBlocks,
): HTMLElement {
  const el = document.createElement(defaultTag);

  // <w:shd w:fill="XXXXXX"/> on the cell — colour the cell background.
  // We render only the `fill` (most common case); patterned shading
  // (`pct10`, etc.) collapses to solid fill.
  if (cell.shading?.fill && cell.shading.fill !== "#auto") {
    el.style.backgroundColor = cell.shading.fill;
  }
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

/**
 * Apply `<w:tblBorders>` to the rendered `<table>` and stamp a class
 * that drives per-cell border rules in CSS. We do it in CSS so the
 * pagination-time split of a table (per-page TR clones) inherits the
 * border styles via the `--border-*` custom properties on the table
 * itself — the cell rules read those vars regardless of which clone
 * the TD ended up in.
 *
 * Word's `<w:tblBorders>` covers the table's outer edges + the
 * inside-horizontal / inside-vertical separators. CSS doesn't have
 * "inside" border selectors, so we approximate by setting `border` on
 * every cell (giving you the inside separators) AND overriding the
 * outer edges with the explicit top/right/bottom/left specs.
 *
 * Tables with `tblStyle="TableGrid"` but no explicit `<w:tblBorders>`
 * also get default thin gray borders — TableGrid is Word's built-in
 * style for "every cell has a border".
 */
function applyTableBorders(t: HTMLElement, table: Table): void {
  const b = table.properties.borders;
  const isGridStyle = table.properties.styleId === "TableGrid";
  // `b` truthy means `<w:tblBorders>` was declared — even if every side
  // resolved to "none" (importer carries an empty object in that case).
  // Treat declared-but-empty as "borderless on purpose"; the TableGrid
  // heuristic only fills in when the doc said nothing at all.
  const explicitlyDeclared = b !== undefined;
  const hasAnyBorderSide = !!(
    b &&
    (b.top || b.right || b.bottom || b.left || b.insideH || b.insideV)
  );
  if (!hasAnyBorderSide && !isGridStyle) return;
  if (explicitlyDeclared && !hasAnyBorderSide) return; // explicit "no borders"

  t.style.borderCollapse = "collapse";
  t.classList.add("sobree-table-bordered");

  // Inside (cell-to-cell) border: prefer insideH / insideV if declared,
  // fall back to a thin gray when only the outer borders are set
  // (matches Word's typical behaviour for fully-bordered tables).
  const inside = b?.insideH ?? b?.insideV;
  const insideCss = inside ? borderSpecToCss(inside) : "1px solid #888";
  t.style.setProperty("--table-cell-border", insideCss);

  // Outer edges — set on the TABLE so the perimeter draws explicitly
  // even when cells would otherwise collapse a half-pixel into the
  // table edge.
  if (b?.top) t.style.borderTop = borderSpecToCss(b.top);
  if (b?.right) t.style.borderRight = borderSpecToCss(b.right);
  if (b?.bottom) t.style.borderBottom = borderSpecToCss(b.bottom);
  if (b?.left) t.style.borderLeft = borderSpecToCss(b.left);
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
