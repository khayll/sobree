---
"@sobree/core": patch
---

Rendering and pagination fidelity:

- Behind-text anchored frames (`behindDoc="1"` — page-background shapes,
  watermarks) paint in a dedicated layer below the body text; previously
  they painted on top of it (visible once theme-colour fills resolved,
  blanking entire pages).
- Multi-level lists render each item at its own level: indent, marker
  glyph, marker box width, and marker formatting per `ilvl` (was: every
  item flattened to one level).
- The paginator counts real inter-item spacing in lists; spaced bullet
  lists no longer over-pack pages and run content through the bottom
  margin.
- Bare inline `<wps:wsp>` shapes (coloured rectangles with no group or
  textbox) render as inline frames — including inside table cells.
- Runs inside run-level `<w:sdt>` content controls import (previously
  dropped); Wingdings 3 `0xF07D` maps to a right-pointing triangle.
