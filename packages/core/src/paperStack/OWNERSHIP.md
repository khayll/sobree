# paperStack — ownership

The **page DOM lifecycle**. Owns the array of `Paper` cards, distributes the
renderer's one continuous flow across them, and runs the repagination
retry loop until pages are stable. This is the DOM-adapter layer that sits on
top of the pure `pagination/` engine.

## Owns

- Paper creation/removal and sizing (`paper.ts`, `pageSetup.ts`).
- Block consolidation + per-page re-distribution (`paperStack.ts`,
  `paginationAdapter/`).
- DOM measurement and paragraph/list splitting across page boundaries
  (`paginationAdapter/{buildItems,distribute,splitParagraph,splitList,
  paragraphLines,columnFlow}.ts`).
- Footnote harvesting + per-page footnote zones (`footnoteFlow.ts`).
- Repagination orchestration: the retry loop that feeds footnote-shrunk page
  budgets back into the next pagination pass (`repagination/`).
- Header/footer + anchored-frame zone rendering per paper (`paperZone.ts`,
  `renderAllZones`, `paintAnchorLayers`).
- Per-section setting application (vAlign) and the `paginate` event.

## Does NOT own (solve elsewhere)

- **The break algorithm** → `pagination/` (pure). The orchestrator calls it;
  it does not re-implement cost or widow/orphan logic.
- **AST → DOM for a block** → `docRenderer/`. The stack moves elements the
  renderer produced; it does not author block markup.
- **AST mutation** → repagination is layout only. If an extraction here ever
  needs to change the document model, STOP — the model is wrong.
- **OOXML parsing/serialization** → `docx/`.

## Repagination contract

`repagination/` is a pure-ish orchestrator over a `RepaginationHost` interface.
DOM operations stay on `PaperStack` (the host); the orchestrator owns only the
retry algorithm. The step order is load-bearing and must be preserved:
collect blocks → ensure ≥1 paper → save selection → baseline budget →
paginate once → distribute footnotes → shrink budgets → retry until stable
(heights unchanged AND overflow ≤ tolerance) or cap → restore selection →
render zones → apply section settings → emit `paginate`. Convergence is dual
(stable footnote heights + overflow within `OVERFLOW_TOLERANCE_PX`); the cap
is `MAX_REPAGINATE_RETRIES`. Changing timing or event order is a behavior
change, not a refactor.

## AST fields consumed / preserved

Consumes `SectionProperties` (margins, page size, vAlign, header/footer refs),
`AnchoredFrame` (for the per-paper overlay), and the rich-zone header/footer
source. It preserves these by re-rendering from them — it persists nothing of
its own onto the AST.

## Y.Doc parity requirements

None directly: pagination is recomputed from the projected AST on every
reload, so the paper stack holds no state that must survive a round-trip. The
fields it *reads* (section settings, anchored frames) are owned and parity-
guarded upstream.

## Tests that should change with this module

- `paperStack.test.ts`, `paper.test.ts`, and (new) `repagination/*.test.ts`
  with a fake `RepaginationHost`. Pagination-engine behavior stays in
  `pagination/paginate.test.ts`.

## Relevant corpus checks

`pnpm corpus:check` — page count and per-line drift are exactly what this
module determines. Spot-check visuals in the playground (`pnpm dev`) for any
zone/anchor/section change; jsdom tests don't catch visual regressions.
