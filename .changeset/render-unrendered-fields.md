---
"@sobree/core": patch
---

Render (and, where needed, import) several formatting properties that were
previously dropped, so documents that use them — and the builder/edit-op
API that can set them — now display correctly:

- **First-line / hanging paragraph indent** (`<w:ind w:firstLine>` /
  `w:hanging`) → CSS `text-indent` — common in prose.
- **Small caps** (`<w:smallCaps>`) → `font-variant-caps: small-caps`.
- **Double strikethrough** (`<w:dstrike>`) → double line-through.
- **Run-level shading** (`<w:shd w:fill>` on a run) → background fill.
- **Hidden text** (`<w:vanish/>`) — hidden by default (print-faithful);
  `showHiddenText` constructor option + `setShowHiddenText(show)` runtime
  toggle reveals it (dotted underline) for editing.
- **Table width + alignment** (`<w:tblW w:type="dxa">` → `widthTwips`,
  `<w:jc>` → `alignment`) — now imported and rendered (table width + auto-
  margin centring / right-align).

Verified against the LibreOffice corpus oracle — all entries within
baseline tolerance (fidelity improvements, not regressions).
