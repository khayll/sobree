---
"@sobree/core": patch
---

Fix a table being hoisted to the front of the first page (its inline
images appearing above the document title).

Tables paginate per row: each `<tr>` becomes a box, and `distributePages`
rebuilds per-page table clones. The iterative repagination loop can leave
a table with multiple `<thead>` / `<tbody>` sections (a clone's section
landing beside the source's). `tableRowBoxes` walked only the FIRST
section of each kind (`querySelector`), so rows in the extra sections were
never emitted as boxes — never paginated, never moved — and the source
table husk that still held them lingered as an orphan, ending up at the
front of the first paper. It now walks every section (`querySelectorAll`),
so every row is distributed exactly once and no husk is left behind.
