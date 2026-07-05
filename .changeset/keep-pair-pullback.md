---
"@sobree/core": patch
---

Infeasible keep-with-next chains now degrade the way Word does —
pairwise: when a block fits on the page but its keepNext successor's
first line doesn't, that ONE block moves to the next page, with no
cascade to its own predecessor. The previous fallback packed the page
to exactly 100% and broke mid keep-pair; a CV's "Achievements:"
heading and bullets landed on the page bottom where Word pushes them
over.
