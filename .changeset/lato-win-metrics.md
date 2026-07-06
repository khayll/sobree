---
"@sobree/core": patch
---

Lato line heights use the font's usWin metrics (1.439×) — Word and
LibreOffice size lines from OS/2 usWinAscent+Descent, and Lato is a
font where those diverge sharply from the hhea table (1.2×). A recipe
card's table rows each rendered ~2pt short, accumulating ~0.4in by the
bottom of the page and floating the anchored logo above its Word
position. When a font's metric tables disagree, the win metrics are
the rule.
