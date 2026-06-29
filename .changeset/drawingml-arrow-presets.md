---
"@sobree/core": patch
---

Render left, up, and down block-arrow shapes faithfully. DrawingML's
`leftArrow` / `upArrow` / `downArrow` presets previously fell back to a plain
rectangle; they now expand to real arrow outlines, generalising the existing
`rightArrow` into one parametrisation (shaft + triangular head, honouring the
`adj1`/`adj2` adjustment handles) oriented per direction.
