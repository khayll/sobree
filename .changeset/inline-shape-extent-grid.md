---
"@sobree/core": patch
---

A pure decoration inline frame (shapes only) keeps its declared
`<wp:extent>` box instead of stretching to its host column — a CV's
photo-placeholder rectangle renders at its true 0.6×0.7in portrait
aspect. Percent-width tables now lay out on Word's column grid
(`table-layout: fixed` + per-cell grid shares), so the placeholder's
column keeps its designed width whatever the cell contains; dxa-width
tables keep content-driven layout until the `<w:tcW>` preference
layer lands.
