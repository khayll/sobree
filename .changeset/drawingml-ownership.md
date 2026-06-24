---
"@sobree/core": patch
---

Internal refactor: clarify DrawingML and PaperStack ownership boundaries.
Split DrawingML inline vs anchored handling into `drawing/` helper modules,
extract the PaperStack repagination retry loop into a testable orchestrator
behind a host interface, and document the renderer/DOCX ownership boundaries.
No public API or behaviour change; backed by focused DrawingML textbox
round-trip coverage.
