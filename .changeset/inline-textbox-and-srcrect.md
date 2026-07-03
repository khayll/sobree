---
"@sobree/core": patch
---

Inline text boxes and image source crops import faithfully. A lone
`<wp:inline>` text box (`wps:txbx`) was silently dropped — the guard
that skipped it deferred to a removed legacy pass, so a letterhead
footer holding its address block in one inline text box rendered
empty; it now imports as an InlineFrame, and header/footer parts run
the same inline-frame pass as the document body. `<a:srcRect>` image
crops are read (fractions on the AST), rendered via a clipping wrapper,
re-exported, and survive the Y.Doc round-trip — a multi-logo strip
cropped to one logo no longer shows the whole strip squeezed into the
extent.
