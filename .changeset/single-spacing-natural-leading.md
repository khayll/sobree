---
"@sobree/core": patch
---

Render single line spacing (`lineRule="auto"`, `line=240`) at the font's
natural leading instead of CSS `line-height: normal`. Browsers resolve
`normal` from rounded font metrics that differ per engine, OS and device
pixel ratio (Times New Roman 12pt measured 18px, 18.398px and 18.5px
across Chromium environments), so page fill — and page break positions —
silently changed with the viewer's machine. Word and LibreOffice always
lay out single spacing at the font's design leading (1.15 × font size,
e.g. 13.8pt for 12pt Times New Roman), which is the same formula every
other `auto` multiplier already used. Pagination is now deterministic
across environments; gatech-thesis-template's live page count converges
to LibreOffice's (23 = 23).
