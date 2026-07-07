---
"@sobree/core": patch
---

Dot-leader TOC / list-of-* lines now render Word-faithfully: the page
numbers form a clean right-aligned column, the dot leader runs
continuously from the entry to the number, and long entries no longer
wrap to a second line.

First, `planRightTailTab` splits a TOC field's single wrapping hyperlink
("entry `\t` page number") around its last (leader/right-stop) tab into a
before-link (entry, keeping any earlier number→title tab) and an
after-link (page number), each keeping the href — so the number
right-aligns at the stop instead of the `tab-size` fallback overflowing
onto a second line. That returned the cms report to 10 pages and closed
the fedramp report's 2-page overshoot (both matching LibreOffice).

Second, the page number is given a DEFINITE, content-derived width (`ch`,
from its own character count) with `text-align: right`. It was a flex
item beside the elastic 512-glyph leader, and Chromium mis-computes such
a span's content-based main size as 0 on indented rows, collapsing it so
the dots bled across the number and it sat short of the stop. The `ch`
box sidesteps that intrinsic size; a wider glyph overflows into the
leader rather than clipping, so the box stays tight and the dots meet the
number. The box is applied only to leader lines — a leaderless right-tab
(e.g. an "org … Page N" footer) sizes its tail naturally. The flex `gap`
on the spread is also dropped so the leader runs flush from entry to
number, as Word draws it; the space-run (label/value) spread keeps its
separation from `justify-content: space-between`.
