---
"@sobree/core": patch
---

fix(table): resolve table-style conditional formatting (shading, banding, grid)

Tables that get their appearance from a `<w:style w:type="table">` rather
than direct cell formatting rendered flat — no header fill, no row banding,
no grid lines. The importer dropped table styles entirely and the renderer
only honoured a cell's own `<w:shd>` / `<w:tblBorders>`, so a document whose
header colour and gridlines live in the style (the common case for Word's
built-in and theme table styles) lost them on import.

Now the full table-style cascade resolves per cell, per ECMA-376 §17.7.6:

- Parse `<w:style w:type="table">` — base `<w:tblBorders>` + band sizes,
  whole-table `<w:tcPr>` shading, and every `<w:tblStylePr>` conditional
  region (`firstRow`/`lastRow`/`firstCol`/`lastCol`, row/column banding,
  corner cells) into `NamedStyle.tableStyle`, merged up the `basedOn` chain.
- Read `<w:tblLook>` (which conditional formats are active, with the
  `noHBand`/`noVBand` → banding-on inversion) and per-cell `<w:tcBorders>`.
- Resolve each cell's shading + border overrides at render time in
  precedence order (whole-table → banding → first/last column → first/last
  row → corner cells), with direct cell formatting still winning, and band
  ranges correctly excluding the first/last row/column when those are active.

The table style's base borders now also draw the grid when the table
declares none of its own. Existing tables (direct `<w:shd>`, `TableGrid`,
explicit-none borders) are unchanged.

Two related border/spacing fidelity fixes ride along:

- **Inside vs. outer borders are now distinct.** Cell borders are drawn
  per edge by position instead of via a uniform CSS `border` on every
  cell, so a style that declares only `insideH`/`insideV` (interior
  gridlines) no longer paints a perimeter frame the document never asked
  for. Fully-bordered tables (`TableGrid`, explicit four-sides + inside)
  render the identical grid as before.
- **Cell padding (`<w:tblCellMar>` / `<w:tcMar>`) is honoured.** The
  table's (or style's) default cell margins now apply as cell padding, so
  cells get their authored breathing room instead of sitting flush against
  the gridlines.
