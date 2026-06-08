---
"@sobree/core": patch
---

Fix two DOCX import/render bugs surfaced by real-world CVs:

- Paragraph styles whose id contains a space (e.g. `"Contact Information"`)
  no longer crash the renderer. The style id is carried in a
  `data-style-id` attribute instead of a CSS class, which also makes the
  style round-trip lossless (the old class lowercased and mangled
  multi-word ids).
- `<w:pageBreakBefore>` now honours its `w:val`. It is a `CT_OnOff`
  toggle, and Word writes the explicit-off form (`w:val="0"`) in
  DocDefaults / styles; reading it by presence alone added a page break
  before every paragraph (a 2-page CV rendered as 32).
