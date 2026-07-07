---
"@sobree/core": patch
---

TOC / list-of-* entries whose whole "entry `\t` page number" is wrapped
in a single hyperlink (a TOC field's result) now right-align the page
number at the leader tab stop, on one line, like Word — instead of
falling to the `tab-size` approximation, which overflowed longer entries
onto a second line. `planRightTailTab` splits the hyperlink around its
last (leader/right-stop) tab into a before-link (entry, keeping any
earlier number→title tab) and an after-link (page number), each keeping
the href, with the stop's dot leader filling the gap. Long dot-leader
lines no longer wrap, so a report's contents page holds what Word's
does — the cms report returns to 10 pages and the fedramp report's
2-page overshoot closes (both matching LibreOffice).
