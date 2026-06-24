# docx/export — ownership

Serializes a `SobreeDocument` back to OOXML. One direction: AST → bytes. The
inverse of `docx/import`; the two must agree on the same DrawingML concepts.

## Owns

- `[Content_Types].xml`, relationships, the document/header/footer parts, the
  ZIP (`contentTypes.ts`, `context.ts`, `document.ts`, `headers.ts`, `zip.ts`).
- Run/paragraph/numbering/style serialization (`runs.ts`, `numbering.ts`,
  `styles.ts`).
- **Drawing serialization** (`drawings.ts`): currently inline images only —
  `<w:drawing><wp:inline>` with `<pic:blipFill r:embed>`. Anchored frames,
  textboxes, shapes, groups, and float margins are **not yet serialized**
  (`DrawingRun.placement`/`anchor`/`floatMarginsEmu` are read by the renderer
  but ignored on export). This is the natural growth area for `docx/drawing`'s
  serialize side.
- Relationship + media-part allocation, deduped by part path (`context.ts`:
  `allocImageRel`, `nextDocPr`).

## Does NOT own (solve elsewhere)

- **Parsing** (XML → AST) → `docx/import`.
- **DrawingML concept math** (EMU/extents/position/wrap/margins/relationship
  shapes) → `docx/drawing/`. When export grows beyond inline images, the
  EMU/position/wrap serializers belong there and `drawings.ts` should call
  them — symmetric with the import readers.
- **DOM / rendering** → renderer. Export reads the AST, never the DOM.

## AST fields consumed / preserved

Consumes `DrawingRun` (`partPath`, `widthEmu`, `heightEmu`, `altText`), and
transitively every block/run kind via `renderBlocks` → `inlinesToRuns`. Round-
trip stability is the contract: paragraphs the editor didn't touch must
re-export byte-stable (`feature.exportFixpoint.test.ts`,
`feature.astRoundTrip.test.ts`).

## Y.Doc parity requirements

Export reads the projected AST, so any field it serializes must already
survive the Y.Doc round-trip (else a reload-then-export drops it). When export
starts consuming a new field, the same parity proof the importer needs applies
— the field must round-trip through `ydoc/` first.

## Tests that should change with this module

- `index.test.ts`, `runs.test.ts`, `styles.test.ts`, `numbering.test.ts`,
  `contentTypes.test.ts`, and the feature round-trips
  (`feature.exportFixpoint.test.ts`, `feature.astRoundTrip.test.ts`).
- Prefer parse-the-output-back assertions over brittle full-XML string equality.

## Relevant corpus checks

`pnpm corpus:check` is import-render focused; export correctness is guarded by
the round-trip/fixpoint feature tests. A DrawingML export change should add a
focused round-trip (import → export → re-import → compare AST fields).
