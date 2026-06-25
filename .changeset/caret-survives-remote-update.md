---
"@sobree/core": patch
---

Keep the caret in place when a remote Y.Doc update re-renders the editor.
A provider update that arrives with a non-local origin — a collaboration
peer, or y-indexeddb's async load completing just as the user starts typing
— ran through `adoptYDocState`, which rebuilt the whole DOM without saving
the selection, so the browser reset the caret to the top of the document
mid-type. It now captures and restores the selection around the rebuild
(the same block-ref save/restore `commit()` uses), so the caret stays where
the user was typing whenever its block survives the update.
