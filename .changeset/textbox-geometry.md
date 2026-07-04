---
"@sobree/core": patch
---

Anchored text boxes keep their container shape's preset geometry — a
decorative page frame authored as an EMPTY text box with a rounded-rect
`<a:prstGeom>` now renders rounded corners, the same as its bare-shape
twin (a CV's frame was rounded on page 1 but square on pages 2+ purely
because the two parts wrapped the same shape differently).
