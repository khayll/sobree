---
"@sobree/core": patch
---

DrawingML colours honour the `<a:alpha>` transform — semi-transparent
fills emit `rgba()` instead of flattening to opaque. Layered page
designs rely on this: an 83%-white rectangle over a grey texture ring
is the LIGHTER inner frame of the design; painted opaque it erased
the band entirely.
