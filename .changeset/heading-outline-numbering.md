---
"@sobree/core": patch
---

Render heading outline numbers ("1", "1.1", "1.2", "2") on headings whose
paragraph style links a numbering definition (`<w:numPr>` on a heading
style) — previously dropped, so numbered headings imported as plain text.

- The style importer now reads a style's `<w:numPr>` into a new
  `NamedStyle.numbering` field.
- A renderer pass walks the body in document order maintaining a counter
  per outline level (with per-level reset), formats each number from the
  numbering definition's `lvlText` + `numFmt` (decimal, roman, letter),
  and stamps it as a `data-outline-number` marker painted via `::before`
  — so the number stays out of the editable text and selection.

Scoped to heading styles (the style's basedOn chain reaches a built-in
`HeadingN`), so style-linked *lists* are not mis-numbered.
