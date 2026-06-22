---
"@sobree/core": patch
---

Render anchored drawings in documents that have no header or footer.

The paper stack gated its body floating-layer paint on the header/footer
"rich zones" context, so a document with floating drawings but no
header/footer silently dropped **all** of its anchored content —
full-page background images, watermarks, shapes, and text boxes. (A
trifold brochure whose entire visual design lives in two full-page
background images rendered as blank text columns.)

Anchored frames are body content, orthogonal to header/footer zones. The
floating layer now carries its own render dependencies (`rawParts` /
`numbering` / `styles`), pulled from the document, and paints whenever
there are frames — independent of whether the document has rich zones.
