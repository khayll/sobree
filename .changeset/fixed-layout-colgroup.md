---
"@sobree/core": patch
---

`<w:tblLayout w:type="fixed"/>` dxa tables lay out on Word's column
grid. Grid-locked tables (pct-width and now fixed-layout dxa) emit a
`<colgroup>` of per-grid-column percent shares + `table-layout: fixed`
— replacing the per-cell width stamping, which CSS fixed layout only
reads from the FIRST row's cells and therefore broke whenever the
first row spanned the grid (a recipe card's full-width title row
degraded every later row to equal columns; its six 0.70in nutrient
columns now match Word). The paginator's table-fragment machinery is
colgroup-aware at both ends: per-page clones carry a copy of the
colgroup, and rejoining fragments moves only THEAD/TBODY sections —
the previous concatenating merge accumulated one colgroup copy per
fragment, multiplying the column count under fixed layout so the real
columns shrank every repagination pass (a one-table CV exploded from
2 pages to 27, one shrunken row per page).
