---
"@sobree/core": patch
---

Make floating text boxes editable. Anchored textbox frames (a flyer's
headings, call-outs, contact block) were a display-only overlay; you
could see them but not click in and type. Now each textbox frame is an
editable island in edit mode — click in, type, and the edit reads back
into `anchoredFrames[id].content.body` and persists to the Y.Doc.

- `anchorLayer` takes an `editable` flag (threaded from the stack's read
  mode): textbox frames become `contentEditable` with `pointer-events`
  re-enabled and a `data-anchor-textbox` marker. Pictures, shapes, and
  groups stay inert.
- The editor routes an `input` whose caret is inside a frame to a frame
  read-back (`serializeHostsToDocument` per frame) instead of the body
  read-back, and skips the stack repaint while a frame is focused so the
  caret survives continuous typing. Read mode repaints the overlay inert.
- Formatting shortcuts work inside frames: when the caret is in a frame,
  the mark commands (`mark.toggle.bold` / italic / underline / strike /
  super- / subscript — Cmd+B/I/U etc.) apply natively to the frame's
  selection, and the read-back's inline serializer maps the resulting
  tags back to run properties.
- Undo/redo of a frame edit now reverts the frame's DOM, not just the AST:
  the change payload carries `liveFrameEdit` so the host skips the overlay
  repaint only for a live keystroke (caret-preserving) and always repaints
  on undo/redo and remote (Y.Doc) changes, which are AST-driven.

Local editing only for now — frame bodies still mirror to the Y.Doc as a
single meta blob, so granular/collaborative per-box editing is a
follow-up. Selection polish (caret placement on click, cross-box undo)
also lands separately.
