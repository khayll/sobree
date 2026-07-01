---
"@sobree/core": patch
---

Resolve OOXML toggle run properties (`caps`, `bold`, `italic`, `strike`) by XOR
across the style cascade, the way Word does. They were applied as inheritable
CSS at BOTH the block element and each run — and CSS can only OR them, so a
`caps` paragraph style plus a `caps` character style DOUBLED into ALL-CAPS
instead of cancelling (the ACM author names rendered "FIRST AUTHOR'S NAME"
instead of "First Author's Name").

Toggles now resolve once per run: the paragraph-style run defaults XOR the
character style, then direct formatting overrides absolutely (the importer keeps
an explicit `<w:b w:val="0"/>` as `false` so it can). The block element no longer
emits inheritable toggle CSS — it can't XOR — so the renderer applies each run's
resolved toggle exactly once. Single-level caps (a lone style `<w:caps/>`, e.g.
a résumé name banner) still uppercase; bold/italic are unaffected in the common
single-level case. `caps: false` round-trips through the Y.Doc.
