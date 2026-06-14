---
"@sobree/core": patch
---

Pagination: a tall table row whose height comes from a non-paragraph
cell (e.g. a bulleted list) is now measured by its tallest cell, so it
splits across the page boundary instead of overflowing the page. The
row's pagination boxes are made to sum to the row's true rendered
height, so the paginator can never under-measure a row and run it past
the bottom margin.
