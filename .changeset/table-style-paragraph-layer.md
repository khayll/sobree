---
"@sobree/core": patch
---

Table styles' own paragraph/run defaults now apply to every paragraph
inside the table, layered between the document defaults and the
paragraph's style (ECMA-376 §17.7.2). Word's built-in `TableGrid`
declares single line spacing and zero after-spacing exactly this way —
cell paragraphs previously fell through to the document defaults
(`line=276 after=200` in the common Word template), rendering every
cell ~1.4pt per line taller than Word/LibreOffice and spilling
table-heavy documents onto extra pages. The mechanism is general: any
`w:tblStyle` chain's `pPr`/`rPr` participates in the cell cascade, and
a paragraph style inside the cell still overrides the table layer.
