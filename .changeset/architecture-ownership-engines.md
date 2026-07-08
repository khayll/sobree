---
"@sobree/core": patch
---

Architecture: extract the pure inline/range and revision/comment mutation
engines into `doc/mutations`, so shared document behaviour has one owner and
`HeadlessSobree` now exposes the same inline-editing + tracked-change review
surface as the browser editor — `insertRun`, `applyRunProperties`,
`wrapRange`, `deleteRange`, `get`/`setTrackChanges`, `getRevisions`,
`accept`/`rejectRevision` (+ format variants), and `resolveComment` /
`reopenComment`. Adds the typed `sobree.paperLayout` bridge (`papers()`,
`nearestPaper()`, `nearestZone()`) so plugins resolve page/paper layout
through a contract instead of hardcoding `.paper*` selectors. Document patch
types, the page-setup model, and the selection descriptor moved down into
the layers that own them. Additive and internal-only — no breaking changes.
