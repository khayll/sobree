---
"@sobree/core": patch
"@sobree/keyboard": patch
---

Tab / Shift+Tab move between table cells. Core registers `table.cellNext` /
`table.cellPrev` on the command bus — the selection moves through the table's
rendered cells in reading order (skipping cells occluded by a vertical merge)
and the target cell's content is selected, as in Word. The keyboard plugin maps
Tab / Shift+Tab onto them, gated on availability: outside a table cell the key
keeps its browser default instead of being swallowed. At the table boundary the
key is consumed but nothing moves (Word would insert a row there; that
structural edit is out of scope). `KeyBinding` gains `onlyWhenAvailable` and
the command bus gains `isAvailable(name)`.

Also fixes a caret inside a NESTED table reading the inner table's cell stamp
against the outer table's block — which could resolve to (and write into) the
wrong outer cell. Nested-table carets now anchor to the outer cell containing
them.
