---
"@sobree/core": patch
---

Render several formatting properties the renderer previously ignored, so
documents that use them (and the builder/edit-op API that can set them)
now display correctly:

- **First-line / hanging paragraph indent** (`<w:ind w:firstLine>` /
  `w:hanging`) → CSS `text-indent` — common in prose and previously dropped.
- **Small caps** (`<w:smallCaps>`) → `font-variant-caps: small-caps`.
- **Double strikethrough** (`<w:dstrike>`) → double line-through.
- **Run-level shading** (`<w:shd w:fill>` on a run) → background fill.
- **Hidden text** (`<w:vanish/>`) — now hidden by default (print-faithful),
  with a `showHiddenText` constructor option and `setShowHiddenText(show)`
  runtime toggle that reveals it (dotted underline) for editing.

Verified against the LibreOffice corpus oracle — all entries stay within
baseline tolerance (fidelity improvements, not regressions).
