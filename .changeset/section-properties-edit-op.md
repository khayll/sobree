---
"@sobree/core": patch
---

Add `editor.sections.setProperties(index, patch)` — a targeted,
undo-integrated edit operation for a section's page geometry (size,
margins), columns, header/footer references, and vertical alignment.
Previously these could only be changed by replacing the whole document.

Section ops are grouped under a new `editor.sections` sub-object
(mirroring `editor.table`) so the Editor facade stays thin as the edit-op
surface grows. `pageSize` / `pageMargins` are field-merged (a partial — e.g.
just `orientation` or `topTwips` — stays valid); other fields replace
wholesale, and an explicit `undefined` clears an optional one. The headless
peer exposes the same change as `applySectionProperties` for Y.Doc parity.
The new `SectionPropertiesPatch` type is exported.
