# docx/drawing — ownership

The single home for **OOXML / DrawingML concept translation**. Every reader
and writer that understands a `<w:drawing>` lives here, split by the DrawingML
concept it owns — not by helper size. Import dispatch (`docx/import`) and
serialization (`docx/export`) *call into* this module; they never inline EMU
math, `relativeFrom` coercion, or wrap-mode parsing themselves.

## Module map (concept ownership)

| file              | owns |
|-------------------|------|
| `model.ts`        | the intermediate `ParsedDrawing` representation (placement, extent, position, wrap, margins, picture, textbox) — decoupled from the Sobree AST |
| `extents.ts`      | `<wp:extent cx/cy>`, `<a:ext>`, EMU conversion, size read/write |
| `position.ts`     | `<wp:positionH/V>`, `relativeFrom`, `posOffset`, alignment, `behindDoc` |
| `wrap.ts`         | `wrapSquare/Tight/Through/TopAndBottom/None`, `wrapText` side |
| `margins.ts`      | `distT/distB/distL/distR` ↔ `textDistancesEmu` / float margins |
| `relationships.ts`| `r:embed`/`r:id` lookup, media target normalization, export rel creation |
| `colors.ts`       | theme palette + `<a:solidFill>`/`<a:ln>` colour resolution (DrawingML colour transforms) |
| `inline.ts`       | `<wp:inline>` ↔ `InlineFrame` / inline `DrawingRun` |
| `anchored.ts`     | `<wp:anchor>` ↔ `AnchoredFrame` (incl. VML float fallback) |
| `textbox.ts`      | `<wps:txbx>`/`<w:txbxContent>` body + `bodyPr` insets |

Not every file must exist before it has content — this table is the target the
extraction grows into. `index.ts` re-exports the public surface.

## Does NOT own (solve elsewhere)

- **DOM knowledge.** A DrawingML helper that needs an `HTMLElement` is in the
  wrong place — positioning-to-CSS belongs in `docRenderer/anchorPosition`.
- **AST persistence semantics** → `doc/types`. This module maps XML ↔ AST; it
  does not define what the AST means.
- **Y.Doc projection** → `ydoc/`. Concept readers produce AST fields; carrying
  them across reload is the Y.Doc layer's job.
- **Pagination / where a frame lands** → `paperStack` + `pagination`.

If a "small extraction" here starts reaching into the renderer DOM or the
Y.Doc schema, STOP and redesign — that's a sign the concept boundary is wrong.

## AST fields consumed / preserved

Reads/writes `AnchoredFrame` (offsets, `wrap`, `wrapText`, `behindText`,
`textDistancesEmu`, `content`: picture/textbox/shape/group), `AnchorOrigin`,
`InlineFrame` (+ `InlineFrameTextbox`), and `DrawingRun` (`partPath`,
`widthEmu`, `heightEmu`, `placement`, `floatMarginsEmu`, `altText`).

## Y.Doc parity requirements

Any new field a reader adds to one of those AST types must round-trip through
`ydoc/`. For run kinds this means extending the `EmbedContent` variant in
`ydoc/runs.ts`, both conversion directions, and a `runs.test.ts` case. Bug
history: `DrawingRun.floatMarginsEmu` was read on import but dropped on
reload until the embed enumerated it. Prove parity with a round-trip test.

## Tests that should change with this module

Co-located concept tests: `inline.test.ts`, `anchored.test.ts`, `wrap.test.ts`,
`position.test.ts`, `textbox.test.ts`, plus `colors`/`extents`/`margins` units.
Prefer parse-back assertions over full-XML string equality. A field touched
here also needs a Y.Doc parity test and, if layout changes, a corpus fixture.

## Relevant corpus checks

`pnpm corpus:check` (anchored/inline drawing fixtures) + `pnpm test:oracle`
(AST snapshot). Baselines change only for an intentional, reviewed fidelity fix.
