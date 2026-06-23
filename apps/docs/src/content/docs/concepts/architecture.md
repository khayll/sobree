---
title: Architecture
description: How Sobree is layered, and why each layer exists.
---

Sobree's architecture is strict layering, each piece replaceable, no piece
that knows more than it has to. Here's the stack:

```
              ┌──────────────────────────────────────┐
              │  Embedder app (your code)            │
              └──────────────┬───────────────────────┘
                             │
              ┌──────────────▼───────────────────────┐
              │  @sobree/core                        │
              │  ┌────────────────────────────────┐  │
              │  │  createSobree() (factory)      │  │  ← blessed entry point
              │  └─────────┬──────────────────────┘  │
              │            │                         │
              │  ┌─────────▼──────────────────────┐  │
              │  │  Sobree (façade)               │  │  ← composes editor + paper stack
              │  └─────────┬──────────────────────┘  │
              │            │                         │
              │  ┌─────────▼──────────────────────┐  │
              │  │  In-core plugin                │  │  ← sections (always on)
              │  └─────────┬──────────────────────┘  │
              │            │                         │
              │  ┌─────────▼──────────────────────┐  │
              │  │  Editor + commands + events    │  │  ← framework-free kernel
              │  └─────────┬──────────────────────┘  │
              │            │                         │
              │  ┌─────────▼──────────────────────┐  │
              │  │  Document AST                  │  │  ← OOXML-flavoured, JSON-clean
              │  └────────────────────────────────┘  │
              │                                      │
              │  ┌────────────────────────────────┐  │
              │  │  Paginator (pure)              │  │  ← box / glue / penalty math
              │  └────────────────────────────────┘  │
              │  ┌────────────────────────────────┐  │
              │  │  Paper stack + Viewport        │  │  ← visual surface
              │  └────────────────────────────────┘  │
              │  ┌────────────────────────────────┐  │
              │  │  DOCX I/O                      │  │  ← import / export bytes
              │  └────────────────────────────────┘  │
              │  ┌────────────────────────────────┐  │
              │  │  History (undo / redo)         │  │  ← editor.history
              │  └────────────────────────────────┘  │
              │  ┌────────────────────────────────┐  │
              │  │  Fonts (fontTable + ODTTF)     │  │  ← editor.embedFont
              │  └────────────────────────────────┘  │
              │  ┌────────────────────────────────┐  │
              │  │  Brand tokens (CSS)            │  │  ← @sobree/core/tokens.css
              │  └────────────────────────────────┘  │
              └──────────────────────────────────────┘
                             │
        ┌──────────────┬─────────────┬─────────────┬──────────────────────┐
        ▼              ▼             ▼             ▼                      ▼
┌─────────────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────────────────┐
│ @sobree/block-  │ │ @sobree/ │ │ @sobree/zoom-│ │ @sobree/             │
│   tools         │ │ keyboard │ │   controls   │ │ collab-providers     │
│ Floating        │ │ Default  │ │ Floating     │ │ + collab-server      │
│  toolbar UI     │ │ shortcuts│ │  zoom dock   │ │ Y providers + relay  │
│ (opt-in plugin) │ │ (opt-in) │ │ (opt-in)     │ │ (opt-in collab)      │
└─────────────────┘ └──────────┘ └──────────────┘ └──────────────────────┘
```

## Layers

### Document AST

The document is a JSON-clean tree of `Block`s — `Paragraph`, `Table`,
`SectionBreak`. Every node maps 1:1 to an OOXML element. No abstraction
between the model and the spec; serialisation to `.docx` is mechanical.

`packages/core/src/doc/`. Pure data — no DOM, no I/O.

### Y.Doc store

Every Sobree editor is backed by a [Yjs](https://yjs.dev) `Y.Doc`.
The Editor mirrors every mutation into the Y.Doc inside a single
`Y.Doc.transact` (origin: `"local"`), so the Y.Doc is a faithful CRDT
representation of the document at all times.

Embedders reach the Y.Doc via `editor.ydoc` (or
`createSobree(...).ydoc`). The intended use is to attach a **Yjs
provider** for persistence or collaboration:

```ts
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb"; // or y-websocket / y-webrtc
import { createSobree } from "@sobree/core";

const ydoc = new Y.Doc();
new IndexeddbPersistence("doc-q2-brief", ydoc);   // local persistence
const editor = createSobree("#editor", { ydoc });  // editor reads from / writes to ydoc
```

**Paragraph blocks** are backed by `Y.Text` (char-level CRDT) — runs
flatten into the Y.Text with marks for run properties and embeds for
breaks / tabs / fields / drawings. Concurrent edits to different
positions of the same paragraph merge correctly. **Tables** are nested
Y structure (per-cell): two peers editing *different cells* — content
or styling — merge, and cell text merges char-level. The **floating
layer** (anchored textbox frames) is the same: each frame is its own
Y.Map, so edits to different frames merge. **Section breaks** are a
JSON leaf — they have no inline content to merge.

`BlockRegistry` ids are prefixed by `ydoc.clientID` so two peers can't
mint the same id. A Y observer watches for remote-origin updates and
re-projects + re-renders. Peers joining an active room adopt the
existing Y.Doc state instead of overwriting it.

Single-user embedders without a provider still get a Y.Doc — it just
has no network attached. The model is the same regardless of whether
collaboration is in play.

`packages/core/src/ydoc/`.

### Editor

A framework-free kernel that mounts on a `contentEditable` host. Owns:

- **`BlockRegistry`** — stable per-block ids + version numbers (the
  optimistic-locking primitive).
- **Events** — `change`, `selection`, `keydown`. Subscribers register via
  `editor.on(...)`.
- **Commands** — a registry of named operations. `editor.commands.register / execute / list`.
  Every plugin coordinates through the bus.

The Editor binds **zero** keyboard shortcuts and exposes **zero** UI. It's
the thing plugins react to and dispatch into.

### Plugins

`@sobree/core` ships one always-on plugin internally:

- **`sections`** — `section.insertBreakAfter` and friends.

Standard commands (`mark.toggle.bold`, `history.undo`, `history.redo`,
…) are registered directly by the Editor constructor — they're always
available on the bus regardless of which plugins are mounted.

Stock plugins live in sibling packages — install only what you want
and pass the factory through `plugins: []` on `createSobree()`:

- **[`@sobree/block-tools`](/api/block-tools/)** — floating toolbar + gutter indicator UI. Factory: `blockTools()`.
- **[`@sobree/keyboard`](/api/keyboard/)** — default keyboard shortcuts (Cmd+Z / Cmd+B / Cmd+Shift+Enter / …). Factory: `keyboard()`.
- **[`@sobree/zoom-controls`](/api/zoom-controls/)** — floating zoom dock (fit page / fit width / − / +). Factory: `zoomControls()`.

For multi-peer collaboration, two more sibling packages — not plugins
in the same sense, but the same opt-in model:

- **`@sobree/collab-providers`** — `attachWebsocketProvider` /
  `attachIndexedDBProvider` / `attachWebRTCProvider` + presence
  overlays. Wraps the canonical Yjs providers.
- **`@sobree/collab-server`** — Node-only y-protocol relay + persister.

`@sobree/core` **does not depend on** any of these. Install only the
ones you need; a headless agent ships just core + `yjs`, an
interactive editor pulls in keyboard + block-tools + zoom-controls,
a collab app adds collab-providers.

Every plugin has the same shape:

```ts
interface SobreePlugin {
  name?: string;
  setup(ctx: PluginContext): { destroy: () => void };
}
interface PluginContext {
  editor: Editor;
  sobree: Sobree;
  viewport: Viewport;
  host: HTMLElement;
}
```

`setup` runs on `createSobree()` mount in array order; `destroy` runs
in reverse on `editor.destroy()`. See [Plugin model](/concepts/plugins/)
and [Building your own plugin](/plugins/build-your-own/).

### Paginator

A pure TeX-style paginator. Takes an `Item[]` (boxes / glue / penalties),
returns `Page[]`. Knows nothing about DOM, content, or rendering. Used by
the paper stack adapter.

`packages/core/src/pagination/`.

### Paper stack + Viewport

The visual surface — `<paper>` elements, paginated via the pure paginator,
laid out inside a zoomable / pannable `Viewport` stage. Paper-level CSS
applies per-section vAlign so multi-section documents render correctly.

### Façade

The `Sobree` class composes editor + paper stack + default plugins, and
exposes the JSON-clean wire-ready API.

### History

A thin wrapper around `Y.UndoManager`. Every local
mutation mirrors into the Y.Doc with origin `"local"`; the undo
manager's `trackedOrigins` is scoped to that origin, so each peer's
`Cmd+Z` reverses **only its own edits**. Remote-provider edits arrive
with a different origin and pass through unrecorded — load-bearing for
multi-peer collab.

Public surface: `editor.history.undo() / redo() / canUndo() / depth() /
on("change", …)` plus the bus commands `history.undo` / `history.redo`.
Typing collapses into one undo step per ~1s pause via Y.UndoManager's
`captureTimeout`; selection is captured in `stackItem.meta` and
restored on the matching pop.

`packages/core/src/history/`. See [History API](/api/history/).

### Fonts

Self-contained module for `word/fontTable.xml` round-trip + ODTTF
codec + OS/2 fsType licence check + runtime `@font-face` registration
of embedded faces. Public API: `editor.embedFont(name, faces)` /
`editor.removeEmbeddedFont(name)`.

`packages/core/src/fonts/`. See [Fonts API](/api/fonts/).

### Factory

[`createSobree()`](/api/create-sobree/) is the entry point most embedders
use. It wires `Viewport` + `Sobree` together, mounts whatever plugins
you pass via `plugins: []`, and returns a flat handle (`getDocument`,
`loadDocx`, `toDocx`, `commands`, `on`, `destroy`, …). It does **not**
auto-mount any UI — toolbar, keyboard, and zoom dock are all opt-in
from sibling packages. Every class beneath the factory remains exported
for embedders who need to wire things up themselves — multiple editors
sharing a viewport, custom layouts, headless / Worker pipelines.

## Deployment tiers

The same Sobree editor scales from "solo doc in a tab" to "many users
in real-time collaboration" without rewriting your app code. The
*only* thing that changes is what Y provider you attach to the
`Y.Doc`. Same editor, same commands, same DOCX I/O.

### Tier 1 — Solo, no server

A user opens a doc, edits, saves to `.docx`. No backend at all.

```ts
import { createSobree } from "@sobree/core";
import { keyboard } from "@sobree/keyboard";
import { blockTools } from "@sobree/block-tools";
import { zoomControls } from "@sobree/zoom-controls";

const editor = createSobree("#editor", {
  content: "# Hello\n\nStart typing.",
  plugins: [keyboard(), blockTools(), zoomControls()],
});
```

That's everything. Sobree creates an internal Y.Doc you never see.
Reload loses state.

**With persistence** — one extra line:

```ts
import * as Y from "yjs";
import { attachIndexedDBProvider } from "@sobree/collab-providers";

const ydoc = new Y.Doc();
await (await attachIndexedDBProvider(ydoc, { dbName: "my-doc" })).synced;

const editor = createSobree("#editor", { ydoc, content: "# Hello…" });
```

Reload restores from IndexedDB. Still no server, still pure
client-side.

### Tier 2 — Sobree + a code peer (LLM agent, automation)

Your editor and an LLM (or any code) collaborate on the same document.
The code peer isn't a server — it's another participant in the Y.Doc,
exactly like another browser tab would be.

The browser side is identical to Tier 1, just with a different
provider:

```ts
import { attachWebsocketProvider } from "@sobree/collab-providers";
const ydoc = new Y.Doc();
const collab = await attachWebsocketProvider(ydoc, {
  url: "ws://localhost:1234",
  room: "doc-q2-brief",
  name: "Alice",
});
await collab.synced;
const editor = createSobree("#editor", { ydoc, plugins: [...] });
```

The code peer (Node, Bun, anywhere) uses
[`HeadlessSobree`](/api/headless/) — same mutation API as the
browser editor, no DOM:

```ts
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { HeadlessSobree, paragraph, text } from "@sobree/core";

const ydoc = new Y.Doc();
const provider = new WebsocketProvider(
  "ws://localhost:1234", "doc-q2-brief", ydoc,
);
await new Promise((r) => provider.once("sync", r));

const sobree = new HeadlessSobree(ydoc, { origin: "llm-agent" });

// Read structure
const blocks = sobree.getBlocks();
console.log("doc has", blocks.length, "blocks");

// React to human edits
sobree.on("change", ({ doc, local }) => {
  if (!local) {
    // Human typed something — LLM decides what to do
  }
});

// Make an edit
const last = sobree.getBlock(blocks.length - 1);
sobree.insertBlockAfter(
  { id: last.id, version: last.version },
  paragraph([text("Added by the LLM.")]),
);
```

The two peers — browser editor and headless LLM — converge through
Y. Per-peer undo (via `Y.UndoManager`'s tracked origins) means the
LLM can `sobree.history.undo()` its own edits without touching the
human's.

The connection between them needs *some* transport. For two-peer
setups, your options:

- **WebRTC peer-to-peer** (`y-webrtc`) — no server. Free public
  signaling servers exist; for production, run your own.
- **Tiny localhost relay** — run `@sobree/collab-server` on the same
  machine. Invisible to the user. `pnpm dev:collab` does this for
  the dev playground.
- **In-process / Worker** — `loopback()` from
  `@sobree/collab-providers` (in-memory), or `MessagePort` if the
  code peer is a Web Worker.

### Tier 3 — Multi-tab / multi-user collaboration

Many peers, real-time, with persistence. The browser code is
*identical* to Tier 2 — you just point the provider at a real
collab-server instead of `localhost`:

```ts
const collab = await attachWebsocketProvider(ydoc, {
  url: "wss://collab.yourdomain.com",   // your hosted server
  room: documentId,
  name: currentUser.name,
  color: currentUser.color,
});
```

The server is [`@sobree/collab-server`](/api/collab-server/) —
Node-only, no Editor, just a y-protocol relay + persister.
Authentication via the `onConnection` hook. Read-only peers via
`{ allow: true, write: false }`. Persistence to disk / S3 / whatever
you wire up.

### What this enables

- **Same code across tiers.** Apps written for solo use can add
  collaboration by changing one provider line. No editor changes,
  no command renames.
- **Swap any plugin.** Want your own keyboard shortcuts? Skip
  `keyboard()` from `plugins: [...]`, write your own that calls
  `editor.commands.execute(...)`. Or extend `keyboard({ bindings: [...] })`.
- **Drive Sobree from anywhere.** Browser, Node, Worker, MCP server,
  cron job — `HeadlessSobree` works wherever Y.js works.
- **Headless DOCX I/O.** `editor.toDocx()` works on a `HeadlessSobree`
  too. Server-side export, batch processing, AI-driven document
  pipelines all fit.
