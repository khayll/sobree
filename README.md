# Sobree

**Embeddable, print-view-first WYSIWYG editor for `.docx`.** Framework-free
core, plugin architecture, native OOXML round-trip, wire-ready API surface.

→ Live editor: [sobree.dev/try](https://sobree.dev/try) · Docs: [docs.sobree.dev](https://docs.sobree.dev)

## Quick start

### Install

`@sobree/core` is the **minimal editor kernel** — AST + paginator + DOCX
I/O + history + fonts. It ships with **zero plugin packages**. Install
the plugins you want and pass them to `createSobree()`.

For an interactive editor with toolbar, keyboard shortcuts, and zoom dock:

```sh
pnpm add @sobree/core @sobree/keyboard @sobree/block-tools @sobree/zoom-controls
```

For a headless / API-driven editor (LLM agent, automation, server-side render):

```sh
pnpm add @sobree/core yjs
```

Use `HeadlessSobree` — same mutation API as the browser editor, no DOM.
For multi-user collab, add `@sobree/collab-providers` (clients) and
`@sobree/collab-server` (relay).

Import `@sobree/core/tokens.css` once at the top of your stylesheet (or
in your entry module) for the brand visuals — amber primary, warm-ink
neutrals, motion / radii / shadows.

### Hello world

```ts
import { createSobree } from "@sobree/core";
import { keyboard } from "@sobree/keyboard";
import { blockTools } from "@sobree/block-tools";
import { zoomControls } from "@sobree/zoom-controls";
import "@sobree/core/tokens.css";

const editor = createSobree("#editor", {
  content: "# Q2 product brief\n\nClick anywhere and start typing.",
  plugins: [
    keyboard(),       // Cmd+B / Cmd+Z / Cmd+Shift+Enter / …
    blockTools(),     // floating toolbar + gutter indicator
    zoomControls(),   // bottom-right zoom dock
  ],
});

editor.on("change", ({ doc }) => {
  // JSON-clean payload — persist however you like.
  console.log("body has", doc.body.length, "blocks");
});
```

`createSobree()` mounts the viewport, runs each plugin's `setup()`, wires
up the paginator, and returns a single handle with everything you need:
`getDocument`, `setDocument`, `loadDocx`, `toDocx`, `commands`, `on`,
`destroy`. Plugins are torn down in reverse-of-mount order on `destroy()`.

### Pick your starting content

The `content` option is polymorphic — pass whatever you have:

```ts
// 1. A markdown string (seed-quality — see "Markdown subset" below)
createSobree("#editor", { content: "# Title\n\nFirst paragraph." });

// 2. Bytes for a .docx file (Blob | File | ArrayBuffer | Uint8Array)
const blob = await fetch("/q2-brief.docx").then((r) => r.blob());
const editor = createSobree("#editor", { content: blob });
await editor.ready; // resolves with { warnings: string[] }

// 3. An AST literal built with the document builders
import { emptyDocument, appendBlock, heading, paragraph, text } from "@sobree/core";
const doc = emptyDocument();
appendBlock(doc, heading(1, [text("Q2 product brief")]));
appendBlock(doc, paragraph([text("Click anywhere…")]));
createSobree("#editor", { content: doc });

// 4. Nothing — start with an empty document
createSobree("#editor");
```

### Save back to `.docx`

```ts
function save() {
  const { blob } = editor.toDocx();
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: "out.docx" }).click();
  URL.revokeObjectURL(url);
}
```

Or load a different file at runtime:

```ts
const file = await pickFile(); // your file picker / drop handler
const { warnings } = await editor.loadDocx(file);
if (warnings.length) console.warn(warnings);
```

### Markdown subset

The markdown string accepted by `content` (and `editor.loadMarkdown(...)`) is
**for seeding example content**, not a real Markdown processor. Supported:
ATX headings (`#`–`######`), paragraphs, bold (`**...**`), italic
(`*...*`, `_..._`), inline code (`` `...` ``), links (`[text](url)`),
single-level bulleted (`-`, `*`) and numbered (`1.`) lists, and two-space
hard breaks. Tables, blockquotes, code fences, images, and nested lists are
out of scope — use the AST builders for those.

### Going off-piste

The factory is the blessed path. If you need to wire `Viewport` / `Sobree`
/ `BlockTools` yourself (custom layout, multiple editors sharing a viewport,
non-default zoom config, etc.), every class still ships individually:

```ts
import {
  Sobree, BlockTools, Viewport,
  importDocx, exportDocx, emptyDocument, paragraph, text,
} from "@sobree/core";
```

The factory composes them; nothing is hidden.

## What's in the box

- **Native OOXML AST.** Every node maps 1:1 to a `<w:…>` element. Round-trip
  is mechanical, not lossy.
- **Y.Doc backed.** The document is a Yjs `Y.Doc`. Single-user app?
  No provider. Want local persistence? `attachIndexedDBProvider`. Want
  real-time collaboration? `attachWebsocketProvider` pointing at
  `@sobree/collab-server`. Want an LLM peer? `HeadlessSobree` in Node
  with any Y provider. **The browser code is identical across all
  four cases** — only the provider differs. See `concepts/architecture`
  for the deployment-tiers walkthrough.
- **Pure paginator.** TeX-style break selection, widow / orphan, keep-with-next,
  forced breaks, multi-section. No DOM, no I/O.
- **Minimal core, opt-in plugins.** `@sobree/core` is the editor kernel —
  AST, paginator, DOCX I/O, history (Y.UndoManager), fonts, Y.Doc backing,
  `HeadlessSobree`, content-hashed binary parts — with two runtime deps
  (`fflate` for ZIP, `yjs` for the CRDT). Keyboard shortcuts, the floating
  block toolbar, and the zoom dock live in sibling packages; install only
  what you want and pass the factories to `createSobree({ plugins: [...] })`.
- **Y-protocol IS the wire.** No separate RPC plugin. External callers
  (LLMs, automation, MCP) participate as Y peers via `HeadlessSobree` —
  same commands, same events, no second source of truth.
- **Visible blocks.** Gutter indicator + floating toolbar per block. Section
  breaks render as labelled rules. Page setup (size, margins, headers, vAlign)
  is a section property edited in-place per section.

## Repository layout

This is a pnpm workspace.

```
sobree/
├── packages/
│   ├── core/                @sobree/core             — Editor, HeadlessSobree, AST, Y.Doc backing, history, fonts, BlobStore, tokens
│   ├── block-tools/         @sobree/block-tools      — Floating toolbar UI (opt-in plugin: blockTools())
│   ├── keyboard/            @sobree/keyboard         — Default keyboard shortcuts (opt-in plugin: keyboard())
│   ├── zoom-controls/       @sobree/zoom-controls    — Floating zoom dock (opt-in plugin: zoomControls())
│   ├── collab-providers/    @sobree/collab-providers — Yjs provider helpers + presence (y-websocket / y-indexeddb / y-webrtc)
│   ├── collab-server/       @sobree/collab-server    — Node-only y-protocol relay + persister (run when you need multi-user)
│   └── mcp/                 @sobree/mcp              — MCP server: ships a `sobree-mcp` CLI so Claude / any MCP client can edit a doc
├── apps/
│   ├── docs/                @sobree/docs           — Astro + Starlight, deploys to docs.sobree.dev
│   └── playground/          @sobree/playground     — Bare Vite app for verifying editor changes (dev-only, not published)
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── .github/workflows/ci.yml
```

The marketing site + hosted product + live demo live in a separate,
**private** repo (`sobree-website`) and ship as `sobree.dev` — including
the editor playground at `sobree.dev/try`. The website is a normal npm
consumer of the public `@sobree/*` packages. The OSS public packages
and the proprietary commercial layer share nothing in git — only in npm.
The brand reference (UI kits, type scale, iconography) also lives in the
private repo as `design-system/`, since it's internal tooling rather than
something an external embedder needs.

## Development

```sh
# Node 22+, pnpm 9+
corepack enable
pnpm install
pnpm dev          # vite dev server for the playground at http://localhost:5174
```

The **playground** (`apps/playground/`) is a bare Vite app that mounts
`createSobree()` with seed buttons, a docx file picker, and a live JSON
state pane — for verifying editor changes during development. Workspace
symlinks resolve every `@sobree/*` package straight to its `src/*.ts`
so HMR works end-to-end.

For collab work: `pnpm dev:collab` boots a local `@sobree/collab-server`
alongside the playground; open `localhost:5174?mode=collab` in two tabs
to see real two-peer sync.
The user-facing demo is at [sobree.dev/try](https://sobree.dev/try) — that
lives in a separate (private) repo.

For docs work: `pnpm dev:docs` launches Starlight at `localhost:4321`.

## Scripts

Run from the repo root — pnpm fans out to each workspace.

| Command            | What it does                                                   |
| ------------------ | -------------------------------------------------------------- |
| `pnpm dev`         | Vite dev server for `@sobree/playground`                       |
| `pnpm dev:collab`  | Local `@sobree/collab-server` + playground; demo two-tab collab|
| `pnpm dev:docs`    | Astro dev server for `@sobree/docs`                            |
| `pnpm build`       | Vite library build for each package + Astro build for docs     |
| `pnpm typecheck`   | `tsc --noEmit` across every workspace                          |
| `pnpm test`        | `vitest run` in every workspace                                |
| `pnpm preview`     | Serve the built docs site locally                              |
| `pnpm check`      | Biome lint + format check                                      |
| `pnpm format`     | Apply Biome formatting                                         |

## Architecture

Strict separation, each layer load-bearing:

- **AST** (`packages/core/src/doc/`) — the OOXML-flavoured document model.
  JSON-clean, deterministic, every shape has an OOXML counterpart. Builders
  (`paragraph`, `heading`, `text`, `softBreak`, …) and the `EditResult` /
  `BlockRef` API surface live here.
- **Editor** (`packages/core/src/editor/`) — framework-free editor core.
  Mounts on a `contentEditable` host. Owns the `BlockRegistry` (stable ids +
  optimistic-lock versions), the `selection` / `keydown` events, and the
  `commands` registry. No DOM positioning or UI concerns.
- **In-core, always-on plugins** (`packages/core/src/plugins/`)
  - `sections` — `section.insertBreakAfter` and friends.
  - `marks` — shared mark helpers + `mark.toggle.*` commands on the bus.
- **Opt-in sibling plugins** (`packages/{keyboard,block-tools,zoom-controls}/`)
  - `@sobree/keyboard` — Ctrl/Cmd shortcuts dispatch through `commands.execute(...)`.
  - `@sobree/block-tools` — floating toolbar + gutter indicator.
  - `@sobree/zoom-controls` — floating zoom dock.
- **Collaboration** (`packages/{collab-providers,collab-server,mcp}/`)
  - `@sobree/collab-providers` — Yjs provider helpers (y-websocket / y-indexeddb / y-webrtc) + presence overlays.
  - `@sobree/collab-server` — Node-only y-protocol relay + filesystem persister; bring your own auth via `onConnection`.
  - `@sobree/mcp` — MCP server. `sobree-mcp` CLI hooks into Claude Desktop and lets the model edit a Sobree doc via standardized tools, optionally alongside human peers.
- **Paper stack** (`packages/core/src/paperStack/`) — the visual `<paper>`
  elements, paginated via the pure paginator. Native CSS for per-page vertical
  alignment.
- **Façade** (`packages/core/src/sobree.ts`) — the `Sobree` class. Composes
  editor, paper stack, and the always-on `attachSections` plugin; exposes
  a JSON-clean wire surface.

Embedders call `createSobree()` from `@sobree/core`, install whichever
sibling plugins they want, and pass the factories in `plugins: [...]`.
Import `@sobree/core/tokens.css` once for the brand visuals. Power-users
can reach for the underlying `Sobree`, `Editor`, `Viewport`, and
`BlockTools` classes directly to wire things by hand.

## Stack

- Vite + TypeScript (strict; `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`)
- Vitest + jsdom for tests
- pnpm workspaces
- Biome for lint + format
- `fflate` for `.docx` ZIP I/O · `yjs` for the CRDT document store — the two runtime dependencies

## Status

`v0.0.x`, pre-publish. The architecture is stable; the public API surface is
settling. Before a `v0.1` release lands: Changesets for versioning, an npm
publish workflow, and finer-grained `@sobree/*` packages carved out of
`@sobree/core` for tighter consumer dependencies.

## Standards & patents

Sobree implements [ECMA-376](https://ecma-international.org/publications-and-standards/standards/ecma-376/)
(Office Open XML) from the published standard. Patent rights for
conformant implementations are granted royalty-free under Microsoft's
[Open Specification Promise](https://learn.microsoft.com/en-us/openspecs/dev_center/ms-devcentlp/9239fe27-6716-4d27-92e1-058674a16cd2);
no separate license, registration, or attribution is required to
read, write, or distribute software that conforms to OOXML.

The ODTTF font-obfuscation transform shipped inside `.docx` files is
documented in ECMA-376 Part 4 §2.8.1 and implemented from the spec.

## License

MIT — see [LICENSE](./LICENSE).
