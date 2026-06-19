---
"@sobree/core": patch
---

Resolve two paragraph-style cascade gaps that made documents render
unlike Word:

- **Style-level first-line / hanging indent.** The style reader only
  honoured `<w:ind w:left>` / `w:right`, so a body style carrying a
  first-line indent (a very common pattern) was dropped and its
  paragraphs rendered flush. It now reads `w:firstLine` / `w:hanging`
  (and the `w:start` / `w:end` aliases) too.
- **`color="auto"` overrides.** A style that set `color="auto"` had it
  silently dropped, so a heading style based on the built-in blue
  `Heading1` inherited the blue instead of resetting to automatic
  (black). `auto` is now kept and rendered as `currentColor`, so it
  correctly overrides an inherited colour.
