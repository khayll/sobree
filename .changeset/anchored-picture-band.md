---
"@sobree/core": patch
---

Lay out a horizontal band of anchored pictures as a row instead of scattering
it. Flyers place several `<wp:anchor>` photos side-by-side at a fixed position
to form a banner strip (the USDA farm-loss handout's three portraits). Each was
converted to a CSS float and pushed to whichever margin it sat nearer, so the
row collapsed and body text filled the gaps. Such a group — two or more
displacing-wrap pictures sharing one empty anchor paragraph and a vertical band
— now coalesces into a single in-flow `InlineFrame` (the same height-reserving
wrapper inline drawing groups use), keeping the row and letting the body text
flow below it. A lone wrap-around image still floats as before.
