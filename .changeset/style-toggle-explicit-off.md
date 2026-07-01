---
"@sobree/core": patch
---

Honour an explicit toggle-off in a paragraph/character STYLE. A style can turn
off a run toggle it inherits from its `basedOn` chain with `<w:b w:val="0"/>` —
the ACM reference-format paragraph (`ACMRef`) switches off the bold it inherits
from `Titledocument`, so the citation renders upright while the "ACM Reference
Format:" heading stays bold. The style importer dropped that explicit `0` (it
only kept `true`), so the cascade kept the parent's bold and the paragraph
rendered bold. Styles now record the explicit `false`, and the cascade resolver
treats it as a definite reset (an inherited toggle re-declared as `true` still
XORs to off, as before). Completes the toggle-property model from the previous
release, which fixed this only for direct run formatting.
