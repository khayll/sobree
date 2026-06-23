---
"@sobree/core": patch
---

Fix caret / selection mapping inside multi-column sections and table cells,
so undo (and any caret restore) lands where you were typing instead of
jumping to the wrong block.

Block elements are nested by the paginator inside papers and column tracks
(`.paper` → `.sobree-cols` → `.sobree-col`), never as direct children of a
content host, so the old positional walk resolved every caret in a column to
the column wrapper. `positionMap` now locates blocks by the stable
`data-block-id` the renderer stamps on every block element. And a position
inside a table now carries a `cell` address (rendered row / cell /
content-block indices) on `InlinePosition`, so a cell caret restores to the
same cell instead of collapsing to the table boundary.
