---
"@sobree/core": patch
---

Endnotes now round-trip: `word/endnotes.xml` imports into the document
model, reference marks render as clickable superscripts linking to an
endnotes list at the document end, and saving emits the part back with
custom reference marks (`customMarkFollows`) preserved.
