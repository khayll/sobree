---
"@sobree/core": patch
---

Rendering-fidelity fixes for complex DOCX layouts:

- **Unequal multi-column sections** (`<w:cols w:equalWidth="0">`) render
  with their per-column widths, and a section with no column break is
  balanced like Word (equal column heights) instead of packing the first
  column to the page bottom.
- **Anchored shape groups** honour their child-coordinate origin
  (`<a:chOff>`), so grouped drawings (e.g. logos) no longer render
  shifted from where Word places them.
- **Custom-geometry shapes** (`<a:custGeom>` — logos, wordmarks, bespoke
  cuts) render as SVG paths instead of a fallback rectangle.
- **`lineRule="exact"` line spacing** is honoured.
- A paragraph style with no `basedOn` inherits **DocDefaults** rather
  than `Normal`.
- Pagination and column balancing **re-run once embedded web fonts
  finish loading**, so a cold reload no longer mis-measures and
  mis-places content.

Also internal-only: the source tree is now Biome-clean and gated, and
the `Editor` constructor was decomposed into focused modules. No public
API changes.
