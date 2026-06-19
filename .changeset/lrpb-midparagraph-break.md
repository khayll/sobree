---
"@sobree/core": patch
---

Stop a mid-paragraph `<w:lastRenderedPageBreak/>` hint from forcing the
whole paragraph onto a new page.

Word records a layout hint at the exact run position where a page broke
last time. A hint at a paragraph's START is a real boundary, but a hint
in the MIDDLE marks where that paragraph's own lines wrapped to the next
page. The importer treated any hint in the paragraph as
`pageBreakBefore`, so a paragraph that should fill the bottom of a page
and continue overleaf was instead shoved entirely to the next page —
leaving the previous page half-empty and inflating the page count. It now
honours only a *leading* hint; mid-paragraph hints are left to the line
paginator, which already splits a paragraph across a page boundary.
