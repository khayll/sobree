# docRenderer — ownership

The DOM projection of a `SobreeDocument`. Turns AST blocks/runs into the
HTML that lives inside a paper's `.content`. Pure-ish: it reads the AST and
emits DOM, it does not decide which page a block lands on.

## Owns

- AST `Block` → DOM element mapping (`block.ts`, `index.ts`).
- Run → inline DOM, including marks, fields, hyperlinks, inline images and
  inline frames (`inline.ts`, `inlineFrame.ts`).
- Paragraph chrome: indents, spacing, tabs, alignment, borders, shading
  (`paragraph.ts`, `properties.ts`).
- List/numbering presentation and outline numbering (`lists.ts`,
  `outlineNumbering.ts`).
- Tables (`table.ts`), section flow markers (`sectionFlow.ts`).
- Anchored-frame *positioning math* and the per-paper anchor overlay
  (`anchorPosition.ts`, `anchorLayer.ts`).
- Font fallback selection (`fontFallback.ts`) and EMU→CSS units (`units.ts`).

## Does NOT own (solve elsewhere)

- **Where a block paginates** → `paperStack/` + `pagination/`. The renderer
  emits one continuous flow; the paper stack splits it across pages.
- **OOXML/DrawingML parsing or serialization** → `docx/import`, `docx/export`,
  `docx/drawing`. The renderer must never read or write XML. If a visible
  drawing problem traces to a missing OOXML attribute, fix the importer and
  carry the value on the AST — do not reverse-engineer it from CSS here.
- **Page lifecycle, header/footer zone DOM, footnote distribution** →
  `paperStack/`.
- **Persisted editor semantics** → the AST (`doc/types`). The renderer is a
  projection; it adds no state the AST doesn't already hold.

## AST fields consumed / preserved

Reads, never mutates: every `Block` and run kind, paragraph/run properties,
`AnchoredFrame` (offsets, `wrap`, `wrapText`, `behindText`, `textDistancesEmu`,
`content`), `InlineFrame`, `DrawingRun` (`partPath`, `widthEmu`, `heightEmu`,
`placement`, `floatMarginsEmu`, `altText`). A new renderer-relevant field is
only safe to consume once it survives the Y.Doc round-trip (below).

## Y.Doc parity requirements

The renderer paints the *projected* document on reload, not the original
import. Any AST field this module reads MUST survive `seedYDoc` →
`projectYDoc`, or the document renders right on first import and silently
degrades on refresh. When you start consuming a new field here, confirm the
`ydoc/` projection carries it and add a round-trip test (see `ydoc/OWNERSHIP`
expectations in `AGENTS.md` → "Y.Doc schema"). Bug history: a floated image's
`DrawingRun.floatMarginsEmu` rendered on import and was lost on every reload.

## Tests that should change with this module

- `block.test.ts`, `inline.test.ts`, `lists.test.ts`, `properties.test.ts`,
  `sectionFlow.test.ts`, `outlineNumbering.test.ts`, `anchorPosition.test.ts`,
  `anchorLayer.test.ts`, `fontFallback.test.ts`, `units.test.ts`.
- AST-shape changes also move `import/feature.fixtures.oracle.test.ts`
  (snapshot) — read the diff before `-u`.

## Relevant corpus checks

`pnpm corpus:check` — any change to emitted DOM can shift line positions and
page counts. Re-baseline only with `pnpm corpus:baseline` after reviewing the
visual diff, and only when the render change is intentional.
