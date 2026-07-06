---
"@sobree/core": patch
---

Paragraph-anchored floating objects hang from the anchor line's
BASELINE, matching Word and LibreOffice — not from the paragraph's
border-box top, which painted a logo anchored to a one-line legend
over the legend's own text. The baseline is measured with a
zero-font-size inline probe (an empty inline box sits exactly on the
baseline), so no font-metric tables are involved.
