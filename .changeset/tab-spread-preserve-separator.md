---
"@sobree/core": patch
---

Tab-spread layouts keep the separator characters in the document text.
The flex spread that lays out "label<tab>value" / TOC leader lines
consumed the tab (or space run) entirely, corrupting the paragraph's
text: copying a line yielded "labelvalue", the DOM→AST serializer lost
the separator, and text-level comparisons unmatched every spread line.
The characters now live in a zero-width span inside the spread — the
flex layout still carries the geometry, the text carries the document.
