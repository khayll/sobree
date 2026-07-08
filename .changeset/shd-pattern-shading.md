---
"@sobree/core": patch
---

Table cells (and paragraphs / runs) with a PATTERN shading now show the
grey Word paints for them. A `<w:shd>` whose `w:val` is a density pattern
— e.g. `pct40` — composites the foreground `w:color` over the background
`w:fill`; with both `auto` (the common "grey divider column" idiom,
`pct40 auto auto`) that is ~40% grey. The importer dropped any shd with
`fill="auto"`, so those cells rendered white, and the three renderers
only read `fill` anyway. `readShading` now keeps a compositing pattern
even over an auto fill (a `clear`/`nil` fill still paints nothing), and a
single `resolveShadingColor` composites pattern + fill + foreground to
the displayed colour for the cell, paragraph, and run renderers alike.
