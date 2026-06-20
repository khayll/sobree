---
"@sobree/core": patch
---

Stop rounding page margins to whole millimetres, which made left/right
margins look uneven.

`sectionToPageSetup` converted each margin from twips to millimetres with
`Math.round`, so Word's default 0.5" margin (720 twips = exactly 12.7mm)
became 13mm. That 0.3mm of slop shifted every margin-anchored frame to the
right — visibly uneven page margins on a centred layout (a flyer's full-
width title sat 13mm from the left but 12.4mm from the right) — and broke
round-trip, since 13mm exports back as 737 twips rather than 720.

Margins now keep two decimals (finer than one twip, ≈0.0176mm), so they
display cleanly (12.7, not 12.69999…) and survive the mm↔twip round-trip
losslessly.

Also stop an empty header/footer from pushing the body off the margin. The
zone-overflow guard (which yields body space when header/footer content is
taller than the margin) counted an empty zone's reserve + blank line as
required clearance, so the body started ~0.2in below the top margin — the
top margin then read bigger than the bottom. An empty zone (including a
header whose only content was a floating watermark, now claimed into the
absolute layer) no longer reserves body space; the body sits at the page
margin, matching Word. Headers/footers with real content still push.
