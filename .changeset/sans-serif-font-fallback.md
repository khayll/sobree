---
"@sobree/core": patch
---

Fall back missing sans-serif fonts to a sans-serif generic, not serif.

When a document's font isn't installed on the rendering host, the CSS
`font-family` chain decides the substitute. Sans-serif families that
weren't in the curated table (Myriad Pro, Open Sans, Segoe UI, Lato,
Montserrat, Roboto, Source Sans Pro, Trebuchet MS, Century Gothic) hit
the unknown-font default, which ends in `serif` — so an Adobe-templated
flyer's Myriad Pro headings rendered in Times while Word, which
substitutes a missing sans with another sans, showed them sans-serif.

Add curated, metric-compatible fallback chains for those families, each
ending in `sans-serif`. The unknown-font default still ends in `serif`
(correct for an unknown serif face, which Word substitutes with Times).
