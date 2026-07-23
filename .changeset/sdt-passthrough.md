---
"@sobree/core": patch
---

Content controls (Structured Document Tags) survive a save. Body-level
`<w:sdt>` wrappers — repeating sections, dropdowns, placeholders, tagged
template fields — previously flattened to their content on import, losing
the control's identity on export. Each flattened block now records its
wrapper (`properties.sdt`, with the `<w:sdtPr>` preserved verbatim), and
the exporter re-groups consecutive members into the original control.
Nested controls keep the outermost identity; editing inside a control
splits it rather than corrupting it. Cell-level and run-level controls
still flatten (documented gap).
