---
"@sobree/core": patch
---

Add numbering / list-definition support: builders
(`numberingDefinition`, `numberingLevel`, plus `bulletDefinition` /
`orderedDefinition` convenience helpers) and the `editor.numbering` edit
operation (`define` / `update` / `remove`) for the `NumberingDefinition`s
in `SobreeDocument.numbering`.

Pointing a paragraph at a list is already `applyBlockProperties(refs, {
numbering: { numId, level } })`; this manages the list-format definitions
those ids resolve to. Mirrored on HeadlessSobree (`defineNumbering` /
`updateNumbering` / `removeNumbering`) with Y.Doc parity.
