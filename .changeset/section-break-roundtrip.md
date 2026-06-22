---
"@sobree/core": patch
---

Fix a multi-column / multi-section document exploding into one page per
section on undo/redo.

The DOM→AST read-back stamped every section break with `toSectionIndex: 0`.
The renderer reads a break's page-break-vs-continuous behaviour from
`sections[toSectionIndex]`, so on the next re-render (undo, redo, or a
remote update) every continuous section break resolved to section 0 (which
defaults to a forced page break) and split the document — a one-page
field-almanac with two continuous section breaks blew up to three pages,
its two-column body torn apart. The live edit hid it because the DOM isn't
rebuilt on a keystroke; redo, which re-renders from the Y.Doc, exposed it.

The read-back now reconstructs each break's real target index by counting
breaks in document order (the Nth break transitions to section N, matching
the renderer's order-based section assignment).
