---
"@sobree/core": patch
---

Typing, deleting and pasting inside a table cell now go through the ops API.

Pasting at a caret in a cell inserted the content AFTER the whole table instead
of into the cell. Tracked-mode typing in a cell was consumed and then dropped —
with track changes on, cells could not be edited at all. Both had the same
cause: the ops address `doc.body`, and a cell caret resolves to its table.

Cell positions (`InlinePosition.cell`) are now AST addresses rather than
rendered ones, and the renderer publishes the address it used on each cell
(`data-cell`). A consumer counting `<td>`/`<tr>` indices reads an address that
diverges from the AST wherever a `vMerge` column occludes a cell, a table
fragments across a page break, or a header row repeats — so caret restore into
such a table could already land in the wrong cell, and a write there would have
edited the wrong cell's text.

Structural edits in cells (Enter) and ranges spanning two cells are not modelled
yet; they decline to the native path rather than being consumed, as before. A
cell holding a list or a nested table isn't addressable by index — the renderer
groups list items into one element — so edits there decline too.
