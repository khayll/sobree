---
"@sobree/core": patch
---

Right-to-left support: `w:bidi` paragraphs render with `dir="rtl"` and
Word's logical alignment semantics (start/end follow the paragraph
direction), `w:rtl` runs keep their direction in mixed LTR/RTL text,
and complex-script sizes (`w:szCs`) round-trip when they differ from
the Latin size. Explicit-off toggles from RTL-enabled Word installs
normalize away instead of bloating LTR documents.
