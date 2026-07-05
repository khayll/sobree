---
"@sobree/core": patch
---

Form-document fidelity, four fixes: (1) `<w:sym>` symbol-font glyphs
import — a HACCP form's Wingdings ❑ checkboxes render via a Unicode
mapping for the common glyphs (checkbox family, check/cross marks,
bullets), with a private-use-codepoint fallback; (2) whitespace passes
through verbatim — the old collapse of 4+-space runs (a fallback-font
compensation obsoleted by proper font loading) destroyed layouts that
push a label right with literal spaces; (3) tab stops accumulate
through the property hierarchy per §17.3.1.38 and multi-tab lines walk
one stop per tab — a footer's "date, tab, tab, sentence" lays out as
Word's single spread line instead of stacking; (4) the anchored-frame
paragraph lookup skips container-local block indices — a logo anchored
to the last body paragraph no longer paints at the top of the page off
a table-cell paragraph's index stamp.
