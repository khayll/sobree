---
"@sobree/core": patch
---

Honest page budgets for re-plan tail pages, and trailing blank pages
render like Word's. A repagination that produced MORE pages than were
previously measured handed the new tail pages the nominal page budget
instead of the measured per-page geometry (footer/footnote reservations
included) — table rows packed against the inflated budget rendered over
the footer zone. Tail pages now extend the last measured page's budget.
Trailing all-empty pages are no longer force-absorbed onto the previous
page: when trailing empty paragraphs fit the last content page the
paginator keeps them there as before, and when they genuinely overflow
they get the real blank page Word and LibreOffice print.
