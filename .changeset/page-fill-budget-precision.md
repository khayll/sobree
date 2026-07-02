---
"@sobree/core": patch
---

Charge Word's real page-fill budget after hard breaks: only the
broken-to paragraph's own space-before starts the new page (the
previous paragraph's space-after dies at the old page bottom), box
heights and inter-block gaps measure sub-pixel instead of integer px,
and twip→mm conversion is sub-twip exact (no ±0.5mm distortion per
spacing value). Thesis title pages that spilled a line onto an extra
page now break where LibreOffice does.
