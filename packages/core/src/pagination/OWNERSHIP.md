# pagination — ownership

The **pure flow engine**. Given a stream of measured items (boxes, glue,
penalties) and per-page height budgets, it decides where the page breaks go.
No DOM, no AST, no XML — just numbers in, break decisions out.

## Owns

- The break algorithm and its cost model (`paginate.ts`, `cost.ts`).
- Widow/orphan, keep-next, keep-together penalties expressed as costs.
- Post-conditions that a valid pagination must satisfy (`postConditions.ts`).
- The item/break vocabulary the DOM adapter must speak (`types.ts`).

## Does NOT own (solve elsewhere)

- **DOM measurement and reconstruction** → `paperStack/paginationAdapter/`.
  This engine never touches an element; the adapter measures boxes and splits
  paragraphs/lists after the engine returns.
- **Retry/convergence across footnote budgets** → `paperStack/repagination/`.
  The engine runs *once* per budget; the orchestrator loops it.
- **Header/footer, zones, sections, anchored frames** → `paperStack/`.
- **What a paragraph looks like** → `docRenderer/`.

Keep this module free of `HTMLElement`. If a change here needs to look at the
DOM, the change belongs in the adapter and the engine's input vocabulary
should grow instead (`types.ts`).

## AST fields consumed / preserved

None directly. The engine consumes adapter-built `Item`s, not AST nodes. The
adapter is responsible for translating AST/DOM state (keep-next, page-break-
before, monolith flags) into items; this engine only sees the translation.

## Y.Doc parity requirements

None directly — pagination derives nothing it persists. Parity is a concern
for the renderer and importer, not the flow engine. (A pagination change can
still *expose* a parity bug if it relies on a field that doesn't survive
reload, but that field is owned upstream.)

## Tests that should change with this module

- `paginate.test.ts` (algorithm + post-conditions). Add cases here for new
  penalty kinds or budget shapes rather than asserting through the DOM.

## Relevant corpus checks

`pnpm corpus:check` — break-decision changes move page counts and the
matched-block ratio directly. The corpus is the integration guard; the unit
tests are the spec. Re-baseline only for an intentional, reviewed change.
