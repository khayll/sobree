# docx/import — ownership

Translates OOXML (`word/document.xml` + parts) into a `SobreeDocument`. One
direction only: bytes → AST. The pipeline order in `index.ts` is the contract.

## Owns

- Document/body walk, paragraphs, runs, tables, sections, headers/footers,
  numbering, styles, comments, footnotes, settings (the per-concept files).
- The **DrawingML import dispatch**: anchored frames, inline frames, and the
  float/flow post-passes (`anchoredFrames.ts`, `inlineFrames.ts`,
  `floatFrames.ts`, `flowFrames.ts`). The OOXML/DrawingML *concept* readers
  these delegate to live under `docx/drawing/` — see that OWNERSHIP.

## Pipeline order (load-bearing)

1. `stripMcFallbacks` (drop `<mc:Fallback>`, surface `<w:txbxContent>`).
2. `buildBodyParagraphIndex` — element→index map, BEFORE any lifter removes
   drawings (the anchor parser uses it to attribute frames to paragraphs).
3. `parseAnchoredFrames` + `parseVmlFloatingFrames` → overlay frames.
4. `parseInlineFrames` → `doc.inlineFrames`.
5. body walk (`convertDocumentXml`), then `floatWrappingImages` and
   `flowDisplacingTextboxes` post-passes that move picture/textbox frames
   into the flow.

Reordering changes output. New drawing work must slot into this order, not
bolt a second pass onto the end (a post-pass that undoes an earlier pass is
the anti-pattern from `CONVERGENCE.md`).

## Does NOT own (solve elsewhere)

- **Serialization** (AST → XML) → `docx/export`.
- **DrawingML concept math** (EMU/extents/position/wrap/margins/relationships/
  colors) → `docx/drawing/`. Import files should *call* those readers, not
  inline EMU arithmetic or `relativeFrom` coercion.
- **DOM, pagination, rendering** → renderer / paperStack.
- **No magic numbers.** Every geometry value comes from the OOXML — read it
  and convert; never paste a millimetre constant (`CONVERGENCE.md` Hard Rule 1).

## AST fields consumed / preserved (produced)

Produces the full `SobreeDocument`: `Block[]`, `AnchoredFrame`, `InlineFrame`,
`DrawingRun` (incl. `floatMarginsEmu`, `placement`), `SectionProperties`,
styles, numbering, `rawParts`. Every field produced here is a field the
renderer and Y.Doc must carry — see parity below.

## Y.Doc parity requirements

A field is not "imported" until it survives reload. Adding/extending an AST
field on import means: extend the `ydoc/runs.ts` embed (for run kinds), add
both conversion directions, and a round-trip test — or the field renders on
first import and vanishes on refresh. This is a HARD requirement (`AGENTS.md`).

## Tests that should change with this module

Per-concept: `anchoredFrames.test.ts`, `inlineFrames.test.ts`,
`floatFrames.test.ts`, `flowFrames.test.ts`, `paragraphs.test.ts`,
`runs.test.ts`, `styles.test.ts`, `tables.test.ts`, `headers.test.ts`, plus
the oracle snapshot `feature.fixtures.oracle.test.ts`. DrawingML concept
readers are tested under `docx/drawing/`.

## Relevant corpus checks

`pnpm corpus:check` — the importer is the top of the fidelity pipeline; most
drift originates here. `pnpm test:oracle` guards the AST snapshot.
