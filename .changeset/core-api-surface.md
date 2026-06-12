---
"@sobree/core": patch
---

Deliberate public API surface. 28 leaked internals are no longer
exported (the granular Y.Doc schema keys and Run↔Delta conversion,
parts-GC, pageSetup-bridge and zone-template internals) — the blessed
Y.Doc wire contract is `seedYDoc` / `projectYDoc` /
`applyDocumentToYDoc`. Breaking only for imports of those internals;
no published consumer used them. Everything kept is now documented:
new API pages for presence, zone editing, page setup, and the Y.Doc
wire API, plus expanded editor/table/marks/events/options docs across
the existing pages. A docs-coverage gate now enforces that new public
exports ship documented.
