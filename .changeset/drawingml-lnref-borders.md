---
"@sobree/core": patch
---

Resolve shape outlines declared as a style reference. Ribbon-inserted gallery
shapes record their default outline only as `<wps:style><a:lnRef idx>` — the
colour on the ref, the width as an index into the theme's `<a:lnStyleLst>` —
with no direct `<a:ln>` in `spPr`. Those borders previously imported as
nothing; they now resolve (colour from the ref, width from the theme line
style; `idx="0"` is the explicit no-line slot), mirroring the existing
`fillRef` fallback so gallery shapes carry their full chrome.
