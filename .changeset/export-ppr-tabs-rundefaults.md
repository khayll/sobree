---
"@sobree/core": patch
---

Paragraph tab stops (`<w:tabs>`) and paragraph-mark run defaults (the
`<w:pPr><w:rPr>` font/size an empty paragraph renders at) now survive a
save. Both imported and rendered but were dropped by the exporter for
every paragraph — label/value layouts lost their custom stops and empty
paragraphs their mark font on an open → save cycle. The export fixpoint's
footnote and comment body comparison is back at full deep equality, which
these two gaps had forced down to structure-only.
