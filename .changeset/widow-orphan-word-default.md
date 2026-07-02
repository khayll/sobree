---
"@sobree/core": patch
---

Widow/orphan control now defaults to Word's semantics: at least 2 lines
of a split paragraph on each side of a page break (`<w:widowControl/>`
is ON by default and PREVENTS single lines; the old 1/1 default read it
backwards). A heading can no longer sit at a page bottom with a single
orphan line of its following paragraph — acm-submission-template's
page 1 now ends exactly where Word's does, with the Introduction
heading opening page 2.
