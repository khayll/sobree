---
"@sobree/core": patch
---

Fix vertical height drift from two compensating defaults, so documents
that specify no font size render at the correct height (and one-page
content stops spilling onto a second page).

- **Default run font size is now 10pt** (the OOXML application default),
  not 11pt. 11pt only applies when a document's `<w:docDefaults>`
  explicitly sets `sz=22` (the `Normal.dotm` template value); a document
  that specifies no size anywhere renders at 10pt in both Word and
  LibreOffice. Sobree's 11pt last-resort baseline over-sized every line
  of such documents by 10%.
- **Calibri now uses the uniform 1.15 natural leading.** The earlier 1.05
  special-case was a mis-calibration that compensated for the 11pt bug
  (11 × 1.05 happened to equal the true 10 × 1.15 for `line=360`). With
  the size corrected, the genuine 1.15 leading applies to every font.

Net effect across the corpus is a broad fidelity improvement (e.g.
complex-multipage line drift dropped ~80%), with no regressions.
Documents that explicitly set a font size, and new content created in the
editor, are unaffected.
