---
"@sobree/core": patch
---

Fix a vertically aligned page rendering top-aligned after a reload. A document
whose section sets `<w:vAlign>` (a centred title page) came back top-aligned
whenever it was mounted from a Y.Doc — the persisted / collaborative path, where
the host passes `ydoc` without `initialDocument`.

The AST was never wrong: `vAlign` round-trips through the Y.Doc fine. Sobree's
constructor seeded the paper stack's sections BEFORE re-deriving its `PageSetup`
from the document. Since `syncStackSections` composes section 0 from that setup,
it published `DEFAULT_PAGE_SETUP`'s "top" and nothing re-pushed sections
afterwards. The two syncs now run in the same order as the `change` listener,
which always had it right.
