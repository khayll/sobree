---
"@sobree/core": patch
---

Honour `<w:contextualSpacing/>` so runs of same-style paragraphs render
tight. Word omits a paragraph's before/after spacing when the adjacent
paragraph shares its style (ECMA-376 §17.3.1.9) — the classic case being a
double-spaced thesis body or a bulleted list. Sobree ignored the flag, so
every such paragraph kept its cascaded `after` (e.g. the docDefaults' 160
twips ≈ 3 mm), inflating page count: the WSU thesis template, where 341 of 378
paragraphs carry the flag, rendered 32 pages against LibreOffice's 27. The
importer now reads the toggle from both direct `pPr` and the style cascade,
the renderer drops the matching margin only when the neighbour actually shares
the paragraph's style, and the exporter writes it back. WSU drops 32 → 30
(body line-pitch and per-paragraph spacing now match LibreOffice exactly);
docs that don't use the flag are unchanged (ACM 13 = 13, NIST SSP 19).
