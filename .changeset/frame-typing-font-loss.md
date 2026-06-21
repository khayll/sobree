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
