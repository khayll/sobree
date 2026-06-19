---
"@sobree/core": patch
---

Fix header/footer `PAGE` / `NUMPAGES` fields that carry a formatting
switch (`PAGE \* MERGEFORMAT`, `NUMPAGES \* Arabic`) rendering a stale
cached value on every page instead of the live page number.

The field-instruction matching was exact (`instruction === "PAGE"`), so
Word's near-universal `\* MERGEFORMAT` switch made it miss and the cached
number leaked through. Recognition now matches the field TYPE (the first
token of the instruction) via a shared `fieldType()` helper, applied
consistently across the three places that resolve page fields (the
per-page zone substitution, the header/footer importer, and the
page-setup bridge).
