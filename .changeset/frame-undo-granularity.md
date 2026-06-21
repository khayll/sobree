---
"@sobree/core": patch
---

Make undo of textbox-frame edits granular per box. Editing two different
text boxes in quick succession and pressing undo reverted **both** in one
step, because `Y.UndoManager`'s capture window coalesced them. Now the
editor closes the undo-capture group whenever the caret moves to a
different editing context — another frame, or between a frame and the
body — so each box's edit is its own undo step, matching Word. Continuous
typing within one box still coalesces into a single undo as before.

(Click-to-place-caret and rapid multi-box editing were already correct on
0.1.24 — native `contentEditable` handles caret placement, and the
`liveFrameEdit` repaint guard keeps rapid cross-box edits from reverting.)
