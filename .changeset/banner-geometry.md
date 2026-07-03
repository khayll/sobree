---
"@sobree/core": patch
---

Table row heights and theme fill-style resolution. `<w:trHeight>` now
imports and renders (`atLeast` = CSS min-height semantics on the row,
`exact` flagged) — banner tables get their designed tall name rows
instead of collapsing to text height. A shape's `<a:fillRef>` resolves
through the theme's actual fill-style lists: solid entries substitute
the shape's placeholder colour, gradient entries render as CSS
gradients, and duotone-textured background entries paint their duotone
midpoint — a CV template's rounded page-frame ring now shows in its
light grey instead of flattening to invisible white. The paginator's
tall-row splitter only splits rows whose CONTENT is tall; rows tall by
declared minimum (newsletter layout scaffolds) stay monolithic and
break between rows like Word.
