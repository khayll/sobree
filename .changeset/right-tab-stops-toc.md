---
"@sobree/core": patch
---

Right-aligned tab stops render TOC-style "entry … page number" lines:
the tail right-aligns at the stop position and the gap fills with the
stop's `w:leader` glyphs (dot/hyphen/underscore/middleDot/heavy) on the
text baseline. Style-declared `<w:tabs>` now reach the cascade (Word's
built-in TOC styles put the stop on the STYLE). Previously the stop was
treated as a left tab, wrapping every TOC entry's page number onto a
second line.
