---
"@sobree/core": patch
---

Two more Word column features:

- **Column separator (`<w:cols w:sep="1">`)** — draw a thin vertical rule
  between columns. The renderer splits the inter-column gap around a centred
  1px rule on each boundary.
- **`<w:noColumnBalance/>`** — the compatibility flag that disables column
  balancing at continuous section breaks document-wide. When set, every
  multi-column section fills column-first instead of balancing its last page.

Both round-trip through the AST (`SectionColumns.separator`, `doc.settings.
noColumnBalance`). The playground `/try` Field Almanac now shows a column
rule in its two-column body.
