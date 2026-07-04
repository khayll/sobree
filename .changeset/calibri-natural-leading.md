---
"@sobree/core": patch
---

Calibri and Cambria (and their metric-clones Carlito/Caladea) line
heights now use their real font metrics for Word's `lineRule="auto"`
spacing: Calibri's natural single-line height is 1.2217× the font size
(hhea tables), not the serif 1.15× applied uniformly before. Every
Calibri document rendered ~6% denser than Word — a CV packed 7 extra
lines onto a page and broke pages early; page 2 now ends within a few
lines of Word's boundary.
