---
"@sobree/core": patch
---

Render the document page background colour. Word stores a page colour as
`<w:background w:color="RRGGBB"/>` and shows it in print layout when
`<w:displayBackgroundShape/>` is set in settings — Sobree parsed neither, so a
flyer with a full-page peach background (the USDA farm-loss handout) imported on
plain white. The importer now reads the gated background colour onto
`document.settings.pageBackgroundColor`, and the renderer paints every `.paper`
with it (falling back to white when absent). Theme-colour and VML-fill
backgrounds aren't modelled yet.

Also fixes a Y.Doc round-trip gap: the projection only re-attached
`document.settings` when `defaultTabStopTwips` was present, so a doc whose
settings were a page background (or `noColumnBalance`) alone lost them on
refresh / collab join. Settings now survive whenever any field is set.
