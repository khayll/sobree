---
"@sobree/core": patch
---

One flow-rendering contract everywhere: the body, header, footer,
footnote zone, inline-frame bodies, and anchored text boxes share a
`sobree-flow` class, and every content-styling rule (links, cell
paragraph metrics, outline numbering, hanging-indent lists, bordered
tables, columns, tab-spread lines) is scoped to it instead of the body
container alone. Zones and text boxes previously missed a dozen rules
— a footer with a list or table rendered unstyled, and tab lines
spread only in the body.
