---
"@sobree/core": patch
---

Export now emits `word/footnotes.xml`, `word/comments.xml` and
`word/commentsExtended.xml`. Footnotes (including custom reference marks)
and comment threads (author metadata, resolved state, replies) previously
imported and rendered but were dropped on save — silent data loss on any
open → edit → save cycle. Reference marks and comment ranges are
reconstructed in the body (`w:footnoteReference`, `w:commentRangeStart/End`,
`w:commentReference`), ranges spanning paragraphs stay balanced, and
body-level ranges don't leak into tables. The export fixpoint suite now
enforces footnote-body and comment-thread equality for every corpus
document.
