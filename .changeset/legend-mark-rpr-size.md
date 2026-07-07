---
"@sobree/core": patch
---

Paragraph-mark run properties (`<w:pPr><w:rPr>`) no longer resize a
paragraph's content runs. Per ECMA-376 §17.3.1.29 the paragraph mark's
rPr styles only the ¶ glyph, so content runs inherit their size from the
style cascade, not the mark. Overriding with the mark rendered a legend
line at its 12pt mark size over 10pt cascade content — ~20% too wide,
running under a behind-text corner logo.

The element's line-box strut and its `lineRule="auto"` leading font now
follow the paragraph's DOMINANT content font and size (most characters,
resolving each run through its character style), instead of the cascade
default. A dense 9pt form under a 12pt cascade no longer draws 12pt line
boxes and grows a page; a 12pt body with a stray smaller run keeps its
12pt strut. An empty paragraph is unchanged: its ¶ mark IS the content,
so the mark still sizes it.
