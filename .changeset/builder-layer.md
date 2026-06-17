---
"@sobree/core": patch
---

Expand the AST builder layer so structured content can be constructed
programmatically without hand-written object literals, and reorganise the
builders into a cohesive `doc/builders/` module (import path unchanged).

New builders: `table` / `tableRow` / `tableCell` (with shading, borders,
gridSpan, vMerge, vAlign), `hyperlink`, `field`, `tab`, `columnBreak`,
`image`, `footnoteRef`, `commentRef`, `sectionBreak`, and `namedStyle`.
They follow one convention — content positional, optional formatting in a
trailing `properties` argument (or a single options object for many-field
nodes), native OOXML units. Existing builders are unchanged.
