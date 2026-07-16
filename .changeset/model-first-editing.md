---
"@sobree/core": patch
---

Model-first editing: every common edit path now flows through the typed ops
API into the AST, and the DOM is re-rendered from it. Previously most edits
were applied by the browser's native contentEditable and read back out of the
DOM — a lossy seam where anything the renderer couldn't express in HTML (and
anything the browser normalised on its way in) could be silently dropped.
Typing, Enter, Backspace/Delete (including word-wise), paste and drag-move
are now all AST mutations; the native path remains only as a fallback for
positions the ops don't yet cover, such as table cells.

Rich HTML paste is the visible upshot: pasted content is parsed to blocks and
runs, so formatting, headings, lists, links and tables survive. It previously
fell back to `text/plain`, pasting styled content as bare text.
