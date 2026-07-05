---
"@sobree/core": patch
---

Tables honour `<w:tblW w:type="pct">` percent widths — a banner table
declaring 103.3% of the text column now reaches past the margins to
meet the page-frame decoration, centred with symmetric overhang, the
way Word lays it out. Percent widths were previously ignored and the
banner stopped short of the frame.
