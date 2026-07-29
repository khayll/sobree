---
"@sobree/core": patch
---

Word can update the table of contents again after a save. The
multi-paragraph `TOC` complex field was flattened to its cached entry
paragraphs on import; the field identity (begin + instruction +
separate … end) now survives as paragraph membership and is re-emitted
on export, so the saved document keeps a live, refreshable TOC. A
first-paragraph entry of a non-hyperlinked TOC — previously swallowed
with the unterminated field — also survives now.
