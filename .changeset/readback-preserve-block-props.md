---
"@sobree/core": patch
---

Stop body edits from silently stripping block-level formatting.

The contentEditable DOM is a lossy projection of the document: it carries
run text and inline marks, but not block-level properties — paragraph
spacing / indent / borders, table style-id / look / cell shading,
section-break targets. The editor re-derived the whole AST from the DOM on
every edit, so each keystroke quietly dropped those properties; the live
DOM hid the loss, but the next re-render from the model (undo, redo, or a
remote update) repainted the degraded document — a styled table lost its
banded rows, a spaced layout collapsed, a one-page doc blew up across
pages.

The read-back now matches each re-read block to its previous AST block by
stable id (the renderer's `data-block-id`) and overlays only the re-read
content, so block properties survive — across plain typing AND structural
edits (Enter / Backspace / paste / reorder), where positional matching
can't. After a structural shift the live block ids are re-stamped so a
subsequent un-rendered edit still matches by id instead of re-deriving.
Editing a richly-formatted document and undoing / redoing now preserves
every block's formatting.
