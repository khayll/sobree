---
"@sobree/core": patch
---

Typing and deleting inside a table cell now go through the ops API, so
track-changes records them. Previously a tracked-mode keystroke in a cell was
consumed and then dropped — with track changes on, cells could not be edited at
all.

Cell positions (`InlinePosition.cell`) are now AST addresses rather than
rendered ones, and the renderer publishes the address it used on each cell
(`data-cell`). A consumer counting `<td>`/`<tr>` indices reads an address that
diverges from the AST wherever a `vMerge` column occludes a cell, a table
fragments across a page break, or a header row repeats — so caret restore into
such a table could already land in the wrong cell, and a write there would have
edited the wrong cell's text.

Structural edits in cells (Enter) and ranges spanning two cells are not modelled
yet; they decline to the native path rather than being consumed, as before.
