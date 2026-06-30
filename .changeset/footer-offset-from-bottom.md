---
"@sobree/core": patch
---

Anchor the page footer the `w:footer` distance from the page bottom, the way
Word does, instead of floating it at the top of the bottom margin. The footer
zone filled the whole bottom margin and top-aligned its content, ignoring the
parsed `<w:pgMar w:footer>` offset — so a short footer sat almost a full
bottom-margin too high and could collide with a body-anchored frame that
legitimately extends into the bottom margin (e.g. a full-page content card,
where the footer text overlapped the card's bottom edge). The footer content is
now bottom-aligned within the zone and lifted by the footer offset, so a single
line lands `footerTwips` from the page edge — matching Word / LibreOffice for
small offsets while preserving the previous position when the offset equals the
bottom margin.
