---
"@sobree/core": patch
---

Export serializes anchored floating drawings back to `<wp:anchor>`
DrawingML: anchored pictures, text boxes (body, fill, border, padding,
rounded/ellipse geometry) and preset-geometry shapes previously rendered
and edited fine but were dropped on save. All three OOXML positioning
forms round-trip (EMU offsets, alignment keywords, wp14 percent
positions), as do percent sizes, wrap modes, text distances, z-order and
behind-text. Also fixes anchored frames after a section break addressing
the wrong paragraph (an index-space mismatch between the importer's
paragraph map and its consumers) — a wrapping image anchored after a
break now floats in its real host paragraph. Group frames,
custom-geometry shapes and header/footer floating drawings remain
documented exporter gaps.
