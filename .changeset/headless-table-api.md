---
"@sobree/core": patch
---

Expose the granular table API on `HeadlessSobree` as `headless.table` —
the same surface as `editor.table` (insert/delete rows and columns,
merge/unmerge cells, set cell content + properties, column width, header
row, table properties). No-DOM peers and LLM agents can now style a cell
or restructure a table without hand-building a whole `Table` block and
calling `replaceBlock`. The surface is shared verbatim with the browser
editor via the `TableHost` interface, so the two never drift, and it
inherits the same optimistic-lock checking.
