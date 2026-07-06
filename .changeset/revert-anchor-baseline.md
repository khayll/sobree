---
"@sobree/core": patch
---

Paragraph-anchored frames measure from the paragraph's TOP again —
reverting the baseline rule from the previous release. Controlled
fixtures (varying font sizes, multi-line anchors, table-adjacent
paragraphs) show Word/LO resolve `relativeFrom="paragraph"` at the
paragraph top invariantly; the baseline fit matched one document
whose ~0.15in displacement remains unexplained and is tracked
separately.
