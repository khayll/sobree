---
"@sobree/core": patch
---

Fix caret / selection mapping inside multi-column sections (and any
paginated layout). Block elements are nested in `.paper` → `.sobree-cols`
→ `.sobree-col`, never as direct children of a content host, so the
positional walk resolved every caret in a column to the column wrapper.
Undo and selection restore then landed the caret on the wrong block (e.g.
the following paragraph). `positionMap` now locates blocks by the stable
`data-block-id` the renderer stamps on every block element, robust to
paper / column / list nesting.
