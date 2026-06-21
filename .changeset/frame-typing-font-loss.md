---
"@sobree/core": patch
---

Fix a textbox frame's text shrinking to the default font (and the font
family corrupting) when you type into it. Two read-back bugs:

- **Bare text node loses styling.** A keystroke can land in a bare text
  node outside the styled run's `<span>` (browsers do this at span
  boundaries). The read-back then emitted a run with empty properties, so
  a repaint rendered it — and the line's derived base font — at the
  default tiny size. Newly-typed text now inherits its nearest styled
  neighbour's properties (font, colour, weight), like a caret's typing
  style.
- **Font-family mangled.** The serializer stripped quotes from the whole
  `font-family` value before splitting on commas, leaving a stray quote
  on the first name (`Myriad Pro Cond'`) that failed to round-trip. It now
  splits first, then strips quotes.
