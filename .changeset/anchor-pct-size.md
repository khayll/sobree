---
"@sobree/core": patch
---

Anchored frames honour Word-2010 percent sizing
(`wp14:sizeRelH`/`sizeRelV` `pctWidth`/`pctHeight`): the rendered size
derives from the page or margin box instead of the stale
`<wp:extent>` snapshot. A CV's footer page-frame declares 108.5% of
the margin box beside an extent computed under different margins —
honouring the extent drew the decorative ring 0.27in too far into the
page on every side, doubling its apparent thickness.
