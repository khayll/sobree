# AGENTS.md

Guidance for AI coding agents and humans working on this repo.

## Rule 0 — How we work

**Forget the word "fix". Solve problems from first principles into
code that is modular, composable, easy to maintain, and easy to
extend.**

When you spot a visible problem:

1. Identify the SHAPE of the problem — what kind of feature is it
   fundamentally (list spacing? floating object? page break? table
   row sizing?).
2. Find the smallest set of OOXML / DrawingML / CSS concepts that
   produce this kind of problem.
3. Locate (or design) the module that should OWN that concept.
4. Make the change inside that module's contract. If the contract
   doesn't accommodate the change, **the contract is wrong** —
   change it, and update every caller. Use TypeScript exhaustiveness
   to surface every callsite.
5. If you find yourself adding a special case at a call site,
   hand-tuning a magic number, regex-matching a CSS string, adding
   a post-process pass to undo what an earlier pass did, or
   threading a `data-*` attribute as an inter-module protocol —
   **STOP**. The model is wrong; redesign.

The full discipline (measurement loop, OOXML grounding, stopping
criteria) lives in `tests/corpus/CONVERGENCE.md`. Read it before
touching the renderer / paginator / importer.

This rule applies even when a stop-hook, an automated check, or
your own instinct pushes you to "just make this number go down."
The number going down via a fix layers technical debt on the next
issue. The number going down via the right model in the right
module is permanent.

## Workspace

| package                  | role                                                                                                                |
|--------------------------|---------------------------------------------------------------------------------------------------------------------|
| `@sobree/core`           | Editor (DOM), **HeadlessSobree** (no-DOM peer for LLMs / automation / MCP), AST, **Y.Doc backing** (Yjs), paginator, DOCX I/O, history (undo/redo via Y.UndoManager), fonts (fontTable + ODTTF), `attachSections` plugin, **presence** module, tokens |
| `@sobree/block-tools`    | Floating toolbar UI — opt-in plugin, mount via `blockTools()` factory in `plugins: []`                              |
| `@sobree/keyboard`       | Default Cmd / Ctrl shortcuts → command bus — opt-in plugin, mount via `keyboard()` factory                          |
| `@sobree/review`         | Tracked-changes & comments review surface — comment threads, per-author colours, accept/reject/resolve. Opt-in plugin, mount via `review()` factory |
| `@sobree/zoom-controls`  | Floating zoom dock (4 buttons) — opt-in plugin, mount via `zoomControls()` factory                                  |
| `@sobree/collab-providers` | Yjs provider helpers — `y-websocket` / `y-indexeddb` / `y-webrtc` factories normalized to a `CollabHandle` shape, plus an in-memory `loopback()` for tests. Pairs with the `attachPresence` / `attachPresenceOverlay` surface in `@sobree/core`.        |
| `@sobree/collab-server`    | Node-only y-protocol relay + persister. Hosts many rooms in one process; speaks pure y-protocol (no Editor instantiation). Filesystem + in-memory persistence backends ship; bring your own for S3 / Postgres / etc. Read-only peers (drops their sync-update msgs) and a session message (type 2: `{isEmpty, isWritable, peerCount}`) for empty-room leader-election. |
| `@sobree/mcp`              | MCP (Model Context Protocol) server. Exposes `HeadlessSobree` mutations as tools an LLM (Claude Desktop, etc.) can call. Two modes: local (own ephemeral Y.Doc) or collab (attach to a `@sobree/collab-server` room and edit alongside humans). Ships a `sobree-mcp` CLI for stdio transport. |
| `@sobree/docs`           | Starlight site at `docs.sobree.dev` (`apps/docs/`)                                                                  |
| `@sobree/playground`     | Bare Vite app for verifying editor changes during dev (`apps/playground/`, not published)                           |
| `@sobree/fixtures-gen`   | Internal tooling (`tools/fixtures-gen/`, not published) — owns the `fixtures:*` and `corpus:*` scripts (fixture generation + render-fidelity corpus runner) |

Dependency graph: `@sobree/core` has **no plugin dependencies** — its runtime deps are `fflate` (DOCX ZIP) and `yjs` (the CRDT document store). Four stock plugin packages (`block-tools`, `keyboard`, `zoom-controls`, `review`) are pure opt-in siblings that peer-dep `@sobree/core`. Embedders install only the plugins they want and pass the factories to `createSobree({ plugins: [...] })`. Sibling plugin packages must not import each other. For wire-driven scenarios (LLM agents, multi-user collab), there is no separate RPC plugin — the Y.Doc is the wire: attach a Y provider (`@sobree/collab-providers`) and edits propagate via Y-protocol.

`mark.toggle.*` and `history.undo` / `history.redo` commands are registered by the Editor itself, not by the keyboard plugin — disabling keyboard never wipes the bus.

## Style

- **Biome** is the only formatter / linter. `pnpm check` / `pnpm format`. Never add ESLint or Prettier.
- **pnpm only.** Never commit `package-lock.json` or `yarn.lock`.
- **Files under ~200 lines.** Split by concern, not by line count.
- **Dead code is removed, not commented out.**
- **Pure-engine + DOM-adapter pattern** where applicable. The paginator and DOCX I/O are pure modules; DOM lives in adapters on top.

## Architectural rules

- `@sobree/core` is framework-free. No Solid / React / Vue / ProseMirror / Tiptap / Lexical.
- `createSobree()` is the blessed entry point. Don't make embedders wire `Sobree` + `Viewport` + `BlockTools` themselves for the common case.
- The `Editor` class binds zero shortcuts and renders zero UI. Plugins dispatch via `editor.commands.execute(...)`.
- The AST is JSON-clean — no functions, class instances, or DOM refs. It must survive `structuredClone` and any wire transport.
- **The document is backed by a Y.Doc.** Every mutation must mirror into `editor.ydoc` inside a `Y.Doc.transact` (origin `"local"`). Paragraph runs are backed by `Y.Text` (char-level CRDT); other blocks store block-level JSON. New mutators must call `mirrorToYDoc()` (or go through `commit()` / `applyDocument()` which already do) so the Y.Doc stays the source of truth for Yjs providers.
- Docs files under `apps/docs/src/content/docs/` that use JSX components or top-level imports must be `.mdx`, not `.md`.

## Update checklist — when X changes, update Y

### Any public API export (added / changed / removed)

- API page at `apps/docs/src/content/docs/api/<topic>.md`
- JSDoc on the export
- Test in the owning package
- For removals: `grep -rn "<ExportName>" apps/docs/src/ packages/*/src/`; flag as breaking

### `createSobree()` factory

- `api/create-sobree.md` · `quick-start/index.md` · `index.mdx` · root `README.md`

### New / removed / renamed package

- Root `README.md` repository layout
- `concepts/architecture.md` diagram + sibling list
- This file's workspace map
- `dependencies` / `peerDependencies` of every package that touches the boundary

### In-core always-on plugin (sections / marks helpers)

- `concepts/plugins.md` defaults table
- `api/create-sobree.md` — only if it changes the public surface

### Sibling-package plugin (block-tools, keyboard, zoom-controls, review, future ones)

- Dedicated `api/<plugin>.md` page (mandatory install snippet + factory usage + direct construction)
- `concepts/architecture.md` diagram branch
- `astro.config.mjs` sidebar entry
- `concepts/plugins.md` "what ships" table — list under opt-in packages
- `plugins/build-your-own.md` — if the new plugin demonstrates a pattern worth referencing
- **Never** add the plugin to `core/package.json` `dependencies` — `@sobree/core` stays plugin-free. Plugin packages peer-dep `@sobree/core`.

### History layer (undo / redo)

- `api/history.md`
- `concepts/architecture.md` history section
- Bus commands (`history.undo` / `history.redo`) registered in `Editor` constructor
- `History` is a thin wrapper around `Y.UndoManager`. **Don't** add a parallel snapshot stack or call `recordCommit`/`recordTyping` — UndoManager auto-tracks ops by origin. If a new mutation site is added, make sure it writes to the Y.Doc with origin `"local"` (via `mirrorToYDoc()` or `applyDocumentToYDoc(..., "local")`); anything else won't be on the undo stack.

### Y.Doc store

- `packages/core/src/ydoc/` — schema, seed, project, apply, runs (Run↔Delta), textDiff (smart Y.Text diff)
- `concepts/architecture.md` — "Y.Doc store" subsection + "Deployment tiers" section
- `api/create-sobree.md` — `ydoc?` option + "Y.Doc + collaboration" section + handle's `ydoc` field
- New mutator? Confirm it routes through `commit()` / `applyDocument()` so the mirror runs. Bypassing those means the Y.Doc desyncs from the AST — providers will see stale state.

### HeadlessSobree (Tier 2)

- `packages/core/src/headless.ts` is the no-DOM counterpart of `Editor`. Adds a new mutation method to the browser editor? Mirror it on HeadlessSobree if it makes sense for headless callers (LLM agents, automation). Pure mutation helpers (`mergeSectionsAcross`, `mergeParagraphProps`, etc.) live in `packages/core/src/editor/internal/mutations.ts` so both classes share them — extend that module rather than duplicating.
- `api/headless.md` documents the public surface.
- Tests in `packages/core/src/headless.test.ts`.

### MCP server

- `packages/mcp/src/tools.ts` — declarative tool catalog. Each tool is `{ name, description, inputSchema, handler(sobree, input) }`. Add a new tool? Define it as a new `ToolDefinition`, push to `ALL_TOOLS`, add a unit test, add an end-to-end test that exercises it through the real MCP `Client`.
- `packages/mcp/src/server.ts` — `createSobreeMcpServer({ ydoc, ... })` returns `{ server, sobree, destroy }`. The MCP server uses the lower-level `Server` + `setRequestHandler` API (not the higher-level `McpServer.tool()` helper) because we need the JSON-Schema-style input validation, not Zod schemas.
- `packages/mcp/src/bin/sobree-mcp.ts` — CLI entry. Stdio transport. Optional `--ws-url` + `--room` for collab mode (lazy-imports `y-websocket`).
- `api/mcp.md` documents the public surface.
- Tests in `packages/mcp/src/{tools,server}.test.ts` (13 + 8). The e2e tests pair our server with a real MCP `Client` over `InMemoryTransport.createLinkedPair()` — same wire path as Claude Desktop, just no process boundary.

### BlobStore — content-hashed binary parts

- `packages/core/src/blob/` — interface (`types.ts`), reference impls (`memory.ts`, `fetch.ts`), local cache (`cache.ts`), hash helper (`hash.ts`). Test suite: `blob.test.ts` (unit) + `integration.test.ts` (end-to-end with Editor / HeadlessSobree).
- The Y.Doc carries TWO part maps: `parts` (inline, legacy) and `partRefs` (hash → BlobStore). Projection unions them; mirror skips partRef-managed paths.
- `Editor.migratePartToBlobStore` is the async upgrade path called from `insertImage` / `embedFont` when a `blobStore` is configured. **Never** write inline bytes after a path's been migrated — that defeats the whole feature.
- `api/blob.md` documents the public surface.
- Hash impl: prefers `node:crypto` when available, falls back to WebCrypto. Reason: jsdom + Node WebCrypto sometimes hit cross-realm typed-array issues; the `node:crypto` path avoids them entirely in tests.

### Y.Doc schema

Paragraph blocks store content as `Y.Text` (char-level CRDT); other blocks as JSON `_ast`. The Run↔Delta conversion lives in `packages/core/src/ydoc/runs.ts`; the diff that preserves CRDT semantics across full-document `applyDocument` calls lives in `packages/core/src/ydoc/textDiff.ts`. **Don't bypass these helpers:** anything that reads/writes paragraph text directly on Y.Text must go through them, or marks/embeds will diverge from the SobreeDocument projection. New non-text run kinds need: (1) an `EmbedContent` variant in `runs.ts`, (2) a case in `appendRun`, (3) a case in `opToRun`, (4) a round-trip test in `runs.test.ts`.

### Fonts module

- `api/fonts.md`
- Files lifted into `packages/core/src/fonts/`
- Round-trip test in `packages/core/src/docx/fonts.test.ts`

### AST / document model

- `concepts/document.md`
- A builder in `packages/core/src/doc/builders.ts`
- Round-trip test under `packages/core/src/docx/`

### DOCX I/O

- `api/docx.md`
- Round-trip test asserting byte-stability for paragraphs the editor didn't touch

### Brand tokens (`packages/core/src/styles/tokens.css`)

- The file is the source of truth — don't duplicate values into component CSS
- Document new semantic tokens in the file's header comment

### DOCX render fidelity

- The corpus runner (`pnpm corpus:check`) compares each fixture's current rendering against its committed baseline (drift, page count, matched-block ratio) and fails on regression
- Update baselines explicitly with `pnpm corpus:baseline` when a renderer change is intentional
- See `tests/corpus/README.md` for fixture layout and contribution rules

## Verification

### Focused test loop (inner-loop, every commit)

`pnpm test` runs the full 813-test suite across 8 packages (~30s). For
the fix-validate-fix loop during dev, that's overkill — most edits
touch one area and a handful of tests in the same package will
catch any regression. Use the narrowest scope that still covers
your change:

```sh
pnpm test:related                 # auto-pick scope from `git diff`
pnpm test:core                    # only @sobree/core (~5s, 711 tests)
pnpm test:oracle                  # only fixtures.oracle (~1s, 12 tests)
pnpm -F @sobree/core test -- import   # only `import.test.ts` files
```

`test:related` reads `git diff --name-only HEAD`, groups files by
package, and runs only the affected packages' test scripts. CSS-only
edits skip the oracle snapshot test (it's an AST-level snapshot —
CSS can't change AST output). Unknown / root-level edits fall back
to the full `pnpm test` to be safe.

**Snapshot updates**: when the oracle snapshot legitimately
changes (e.g. new AST field after an import-side fix), update with
`pnpm -F @sobree/core test -- fixtures.oracle -u`. Don't run with
`-u` blindly — read the diff first to confirm the AST change is
intended.

### PR gate (run before committing)

```sh
pnpm typecheck                    # all workspaces
pnpm test                         # vitest in each package
pnpm -F @sobree/docs build        # catches stale / broken-MDX docs
pnpm corpus:check                 # render fidelity gate (needs `soffice` on PATH)
```

All four green is the gate before any PR. The docs build is non-optional — it's the only thing that catches MDX errors and dead links in content pages. `corpus:check` requires LibreOffice; if you don't have it locally, CI will run it for you.

For changes that touch editor visuals (toolbar, indicator, pagination, paper stack, zone editor), spot-check in the **playground** before opening a PR — `pnpm dev` launches it at `localhost:5174`. Tests run in jsdom and don't catch visual regressions.

For collab-affecting work, **`pnpm dev:collab`** boots a local `@sobree/collab-server` + the playground together. Open `http://localhost:5174?mode=collab&room=demo&name=Alice` in two browser tabs (vary the `name` param) to see real two-peer collab. Persistence lands under `.dev-collab-data/` (gitignored).
