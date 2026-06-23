---
"@sobree/core": patch
---

Route the browser `Editor` and `HeadlessSobree` through a single shared
pure document-mutation engine, so block operations (insert / replace /
delete, and the read-back merge that preserves block-level formatting)
behave identically whether you drive the DOM editor or the headless one.
Backed by browser/headless parity tests. Internal refactor — no public
API changes.
