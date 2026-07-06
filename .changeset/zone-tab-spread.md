---
"@sobree/core": patch
---

Tab-spread layout applies inside header/footer zones — the flex rules
were scoped to the body content only, so a footer's tab line rendered
unspread: the date wrapped onto two lines and the sentence ran full
width into the corner logo instead of right-aligning at its tab stop.
A zone is flow + floats like the body; its tab lines now lay out
identically.
