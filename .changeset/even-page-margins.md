---
"@sobree/core": patch
---

Fix page margins: sub-millimetre precision, and frame vertical anchoring
that matches Word's header reserve.

Two issues made the marketing flyer's margins drift from Word:

- **Left/right uneven.** `sectionToPageSetup` rounded each margin twips→mm
  with `Math.round`, so Word's 0.5" margin (720 twips = exactly 12.7mm)
  became 13mm — shifting margin-anchored content 0.3mm right (13mm left
  vs 12.4mm right) and breaking round-trip (13mm exports as 737 twips).
  Margins now keep two decimals (finer than a twip), so they display
  cleanly and round-trip losslessly.

- **Bottom content too high.** A `verticalFrom="margin"` body frame (the
  flyer's contact email) was resolved against the nominal top margin, but
  Word/LibreOffice measure it from the top of the text area — which the
  header reserve pushes ~0.2in below the nominal margin. The email sat
  bunched against the phone line above it. Body margin-anchored frames now
  share the header-cleared origin used by paragraph-anchored frames, so
  they land where Word draws them. (The top margin is legitimately larger
  than the bottom here — Word reserves the empty header line — and Sobree
  already matched that; only the margin-anchored frame was off.)
