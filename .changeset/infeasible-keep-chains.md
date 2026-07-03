---
"@sobree/core": patch
---

Keep-with-next chains longer than a page now degrade to natural page
breaks, and consecutive forced page breaks coalesce. A document styling
every job-title / company / spacer paragraph as a keepNext heading
chains dozens of blocks; every break inside the chain is forbidden, and
the paginator picked the earliest equally-forbidden candidate — one
near-empty page per block (a CV exploded from 3 to 13 pages). Word
breaks an infeasible keep chain at the natural page boundary, and a
page-break-before at the top of an already-fresh page is satisfied,
not stacked into a blank page (thesis front matter rendered a blank
page between two title pages). Widow/orphan back-off also no longer
retreats INTO a forbidden keep break.
