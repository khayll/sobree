---
"@sobree/core": patch
---

Multi-column sections now **snake across pages**. Previously a section with
`<w:cols>` was laid out as one monolithic, single-page block — equal-width
columns relied on CSS `column-count`, which cannot fragment across the
editor's fixed-height page boxes, so anything taller than one page was
clipped. A multi-page two-column document rendered as a single overflowing
page.

`flowColumnSections` (formerly the unequal-only `flowUnequalColumnSections`)
now owns the whole 2-D layout for **both** equal- and unequal-width
sections: it flows content in newspaper order — fill column 0 to the page
bottom, then column 1, then continue on the next page — emitting one
page-sized column wrapper per page. The paginator stays column-agnostic and
simply places each wrapper, so columns snake from page to page. Interior
pages are filled; the final page is balanced (Word's "balance columns at
section end"), which keeps single-page sections byte-identical to before.
