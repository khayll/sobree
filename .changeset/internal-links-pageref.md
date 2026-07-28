---
"@sobree/core": patch
---

Internal hyperlinks and live PAGEREF page numbers. `<w:hyperlink
w:anchor>` now imports as a fragment href, exports back as `w:anchor`,
and renders as a working in-document link; bookmark markers render as
addressable zero-width spans. PAGEREF fields nested inside hyperlinks
(the shape every Word TOC entry uses) survive import as fields, and
after pagination their page numbers update live to match the actual
layout — TOC page numbers stay correct as the document is edited.
