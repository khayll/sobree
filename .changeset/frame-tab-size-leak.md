---
"@sobree/core": patch
---

A host paragraph's tab grid no longer leaks into its inline frame's
text. `tab-size` is CSS-inherited, so the host paragraph's `<w:tabs>`
(applied to the frame wrapper with the rest of its properties) shadowed
the document's default tab grid for every paragraph inside the box —
ljmu-letterhead's footer socials line inherited the Footer style's
4513-twip centre stop as a 79.6mm tab advance and wrapped onto two
lines where Word's 720-twip default grid keeps it on one. Word resolves
a textbox's inner paragraphs against their OWN stops, falling back to
the document default.
