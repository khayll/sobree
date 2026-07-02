---
"@sobree/core": patch
---

Match Word's page-fill budget: suppress space-before at the top of a page
and stop double-counting single-line paragraphs' margins. Word ignores a
paragraph's "space before" when it lands at the top of a page through an
automatic break (honouring it after an explicit page break) — Sobree kept
the margin, wasting up to a heading's spacing on every such page. Worse,
the paginator's box measurement ADDED `margin-top` to every single-line
paragraph's height even though the inter-block glue already carried that
gap, so pages holding several spaced headings ran a phantom ~15-25px
fuller per heading and broke a paragraph or two earlier than
Word/LibreOffice. With both fixed, page fill matches Word's budget —
acm-submission-template renders 13 pages breaking mid-paragraph exactly
where Word does (was 14), and other over-paginating fixtures move toward
LibreOffice's counts. Explicit `<w:pageBreakBefore/>` paragraphs keep
their space-before, now correctly charged to the new page.
