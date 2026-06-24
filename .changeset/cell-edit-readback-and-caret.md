---
"@sobree/core": patch
---

Fix two issues when typing in a table cell: an unrelated block (e.g. a
small-caps masthead line) losing run styling, and the caret jumping to the
top of the page on the re-pagination that follows.

- The DOM read-back is a lossy inverse of the renderer (it didn't read
  `font-variant-caps` / `text-transform` / double strike-through back). A
  keystroke triggers a full-body read-back, so an UNCHANGED block was being
  re-derived and losing those run properties. The read-back now keeps a
  paragraph's previous runs verbatim unless its text actually changed, and
  also reads `smallCaps` / `caps` / `doubleStrike` back for the edited block.
- Repagination rebuilds the paper DOM (re-rendering tables that split across
  pages), so the caret was saved as a raw `(node, offset)` that no longer
  existed after the rebuild — restore gave up and dropped the caret to the
  top. Repagination now saves/restores the caret in model terms (stable
  `data-block-id` + offset + cell address), resilient to the rebuild.
