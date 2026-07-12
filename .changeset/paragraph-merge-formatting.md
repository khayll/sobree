---
"@sobree/core": patch
---

A paragraph-boundary Backspace / Delete (a paragraph MERGE) now runs
through the typed API even when track-changes is OFF, instead of falling
through to the browser's native contentEditable. The native merge is
lossy — Chromium strips inline run formatting (small-caps, colour,
font-size) off the joined-in content while moving its nodes — and the
DOM read-back then adopted those stripped runs because the paragraph's
text had changed. So merging two styled lines (e.g. copy a styled line,
paste it, Backspace at the next line's start) left the merged-in half
unstyled. The API merge concatenates the two paragraphs' AST runs with
formatting intact; only paragraph-boundary deletes are intercepted, so
ordinary mid-line deletes keep the light native + read-back path.
