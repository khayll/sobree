---
"@sobree/core": patch
---

Block-level bookmark markers survive import. `w:bookmarkStart`/`End`
written as direct children of the body or a table cell (Word's shape
for TOC targets that open before the first paragraph, and `_GoBack`)
were silently dropped; they now normalize into the nearest paragraph,
so PAGEREF/TOC entries pointing at them resolve instead of dangling.
