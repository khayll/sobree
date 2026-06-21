---
"@sobree/core": patch
---

Fix a textbox frame's text shrinking to the default font (and the font
family corrupting) when you type into it.

- **Font no longer survives at the run level alone.** A textbox frame
  carries its font on the runs, with no named style to fall back on — so
  when a keystroke lands in a bare text node (browsers do this at span
  boundaries), or a select-all-retype replaces every styled span with one
  unstyled node, the runs lose their font and the next repaint renders the
  whole line at the default tiny size. The frame read-back now promotes
  each paragraph's rendered base font to `ParagraphProperties.runDefaults`
  — a paragraph-level default the renderer already honours — read from the
  `<p>` element's own inline font, which the browser preserves through
  these edits. The font now survives even when every run loses its inline
  styling. Body flow is unaffected: its runs stay style-linked.
- **Font-family mangled.** The serializer stripped quotes from the whole
  `font-family` value before splitting on commas, leaving a stray quote on
  the first name (`Myriad Pro Cond'`) that failed to round-trip. It now
  splits first, then strips quotes.
- **Undo/redo lost the caret in a frame.** A frame's contentEditable body
  isn't a body registry block, so the `Selection` model couldn't address it
  and undo skipped the cursor restore — the rebuilt overlay then dropped
  focus to `<body>`, and the next `Cmd+Z` didn't route until you clicked
  back in. Frame selections are now first-class in the undo machinery, with
  the same cursor behaviour you get in the body and in Word/Docs:
  - **Undo lands where the edit began, redo where it ended.** Each undo step
    stashes both the pre-edit selection (captured at `beforeinput`, before
    the DOM mutates) and the post-edit one; undo restores the former, redo
    the latter. A coalesced typing burst keeps its original start but
    extends its end, so redo lands at the tail of the whole burst.
  - **Replacing a selection reselects it on undo.** Frame selections are
    captured as a `{ start, end }` character span, not just a caret, so
    undoing a type-over restores the original highlight.
  - Focus returns to the frame even if it had moved elsewhere first, and the
    caret/range clamps cleanly when an undo reverts to shorter text.

  The body's own undo cursor behaviour is unchanged.
