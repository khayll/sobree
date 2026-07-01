---
"@sobree/core": patch
---

Two coupled pagination/spacing fixes.

**`atLeast` / `exact` line rule.** The renderer only honoured `lineRule="auto"`,
so paragraphs with `<w:spacing w:lineRule="atLeast" w:line="N"/>` (every ACM
style; common in academic templates) fell back to the font's natural leading and
rendered ~25% too tight. `atLeast` now applies the absolute minimum line height
when it exceeds the natural leading (matching LibreOffice exactly — e.g. an
abstract at 12pt, body at 13.5pt), leaving `normal` otherwise so a taller inline
still grows the line.

**Per-page pagination budget.** The page budget was taken from page 1's content
area, which is shrunk by page-1-specific reservations (a first-page footer, a
footnote), then applied to every page — so all pages under-filled (the ACM
template's page-1 footnote stole ~72pt from all 15 pages). The baseline is now a
normal page's body area (paper height − header reservation − nominal bottom
margin), and per-page budgets are measured from each paper's OWN geometry, so a
page-specific footer/footnote shrinks only that page.

Together these make most multi-page corpus fixtures match LibreOffice's page
count exactly (ieee-trans, gatech, jellap, complex-multipage, lease, healthcare,
pentest, nih, …) with faithful line spacing. A few remain ±1; wsu-thesis and
fedramp still over-count from a separate, pre-existing cause.
