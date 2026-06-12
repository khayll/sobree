---
title: createSobree()
description: One-call factory that mounts the viewport, the editor, and the floating block toolbar.
---

`createSobree()` is the blessed entry point — one call mounts the
`Viewport`, the `Sobree` façade, and the floating `BlockTools` toolbar,
and returns a flat handle with everything an embedder needs day-to-day.

```ts
import { createSobree } from "@sobree/core";
import "@sobree/core/tokens.css";

const editor = createSobree("#editor", {
  content: "# Hello\n\nStart typing.",
});
```

Every class and function the factory composes (`Sobree`, `Editor`,
`Viewport`, `BlockTools`, `importDocx`, `exportDocx`, the AST builders) is
also exported individually for embedders who need to build the wiring
themselves — see [Going off-piste](#going-off-piste).

## Signature

```ts
function createSobree(
  target: string | HTMLElement,
  options?: CreateSobreeOptions,
): SobreeHandle;
```

`target` accepts a CSS selector or an `HTMLElement`. A selector that doesn't
match an `HTMLElement` throws synchronously.

## Options

```ts
interface CreateSobreeOptions {
  /** Initial content. See "Polymorphic content" below. */
  content?: string | Blob | ArrayBuffer | Uint8Array | SobreeDocument;

  /** Page setup. Falls back to A4 portrait with 1in margins. */
  pageSetup?: PageSetup;

  /**
   * Plugins to mount. `@sobree/core` ships with zero plugin packages —
   * install the ones you want and pass their factories here. Mounted
   * in array order; destroyed in reverse on `editor.destroy()`.
   *
   * Stock factories: `keyboard()` from `@sobree/keyboard`,
   * `blockTools()` from `@sobree/block-tools`, `zoomControls()` from
   * `@sobree/zoom-controls`. Or write your own — see [Building
   * your own plugin](/plugins/build-your-own/). For multi-peer
   * collab, attach a Yjs provider from `@sobree/collab-providers`
   * (not a plugin — the Y.Doc itself is the wire).
   */
  plugins?: SobreePlugin[];

  /** Forwarded to the underlying Editor. */
  changeDebounceMs?: number;

  /**
   * Y.Doc backing the document. The editor mirrors every mutation
   * into this Y.Doc; embedders attach Yjs providers (`y-websocket`,
   * `y-indexeddb`, `y-webrtc`, …) for persistence / collaboration.
   * If absent, the editor creates one internally — still observable
   * via `handle.ydoc` / `handle.editor.ydoc`.
   */
  ydoc?: import("yjs").Doc;

  /**
   * Optional content-hashed `BlobStore` for binary parts.
   * Without one (default), binary parts (images, fonts) ride inline
   * in the Y.Doc. With one, the editor uploads bytes to the store
   * and writes only hashes into the Y.Doc — Y updates stay small
   * regardless of image size.
   *
   * See [BlobStore](/api/blob/) for the interface, reference impls
   * (`inMemoryBlobStore`, `fetchBlobStore`), and the migration model.
   */
  blobStore?: BlobStore;

  /**
   * Auto-fit the viewport to the first paper after mount. Default
   * "width" — what most embedders want for a "looks right out of the
   * box" first impression.
   *   - "width" (default) — first paper fills the host width.
   *   - "page"            — first paper is fully contained.
   *   - "none"            — leave the viewport at 1:1.
   */
  fitOnMount?: "width" | "page" | "none";
}
```

The default `fitOnMount: "width"` is why the editor renders looking
like a printed page right after `createSobree()` — without it you'd
see the A4 paper at 1:1 (typically much smaller than the host). Pass
`fitOnMount: "none"` if you're driving zoom yourself.

## A typical interactive editor

Three plugins, all installed separately:

```sh
pnpm add @sobree/core @sobree/keyboard @sobree/block-tools @sobree/zoom-controls
```

```ts
import { createSobree } from "@sobree/core";
import { keyboard } from "@sobree/keyboard";
import { blockTools } from "@sobree/block-tools";
import { zoomControls } from "@sobree/zoom-controls";
import "@sobree/core/tokens.css";

const editor = createSobree("#editor", {
  content: "# Hello\n\nStart typing.",
  plugins: [
    keyboard(),       // Cmd+B, Cmd+Z, etc.
    blockTools(),     // floating toolbar + gutter indicator
    zoomControls(),   // bottom-right zoom dock
  ],
});
```

A headless code peer (LLM agent, automation) skips `createSobree`
entirely and uses [`HeadlessSobree`](/api/headless/) directly on a
shared Y.Doc — see
[quick-start example 2](/quick-start/#example-2-editor--a-code-peer-llm-agent--automation).

## Polymorphic content

The `content` option (`SobreeContent`) is type-detected:

| value type            | treated as                          | sync / async       |
|-----------------------|-------------------------------------|--------------------|
| `string`              | seed-quality Markdown               | sync               |
| `Blob` / `File`       | `.docx` bytes                       | async (see `ready`) |
| `ArrayBuffer`         | `.docx` bytes                       | async              |
| `Uint8Array`          | `.docx` bytes                       | async              |
| `SobreeDocument`      | AST literal (use the doc builders)  | sync               |
| `undefined`           | empty document                      | sync               |

For the async case the constructor returns synchronously with an empty
editor, kicks off the import in the background, and resolves
`editor.ready` once the document is loaded.

```ts
const editor = createSobree("#editor", { content: blob });
const { warnings } = await editor.ready;
if (warnings.length) console.warn(warnings);
```

## Markdown subset

The Markdown accepted by `content` and by `editor.loadMarkdown(...)` is
**for seeding example content**, not a real Markdown processor. Supported:

- ATX headings (`#` … `######`)
- Paragraphs (blank-line separated)
- Bold (`**...**`), italic (`*...*` or `_..._`), inline code (`` `...` ``)
- Hyperlinks `[text](url)`
- Two-space hard line breaks
- Single-level bulleted (`-`, `*`) and numbered (`1.`) lists

Out of scope: tables, blockquotes, code fences, images, nested lists,
reference-style links, footnotes, autolinks, HTML. For those, build the
document with the [AST builders](/api/builders/).

The parser is exported as `parseMarkdown(md): SobreeDocument` for
seeding content outside the factory — headless flows, tests, server
code building a Y.Doc with `seedYDoc`.

## The handle

`createSobree()` returns a `SobreeHandle`:

```ts
interface SobreeHandle {
  // === escape hatches ===
  readonly sobree: Sobree;
  readonly editor: Editor;
  readonly viewport: Viewport;
  /** Y.Doc backing the document — see "Y.Doc + collaboration" below. */
  readonly ydoc: import("yjs").Doc;

  // === readiness ===
  readonly ready: Promise<{ warnings: string[] }>;

  // === document I/O ===
  getDocument(): SobreeDocument;
  setDocument(doc: SobreeDocument): void;
  loadMarkdown(md: string): void;
  loadDocx(src: File | Blob | ArrayBuffer | Uint8Array): Promise<{ warnings: string[] }>;
  toDocx(): { blob: Blob; warnings: string[] };

  // === page setup ===
  getPageSetup(): PageSetup;
  setPageSetup(partial: Partial<PageSetup>): void;

  // === commands + events ===
  readonly commands: CommandBus;
  on<E extends SobreeEvent>(event: E, cb: (p: SobreeEventPayload[E]) => void): SobreeUnsubscribe;

  // === lifecycle ===
  destroy(): void;
}
```

### Events

```ts
editor.on("change",      ({ doc, revision }) => /* … */);
editor.on("paginate",    ({ pageCount })     => /* … */);
editor.on("setup",       ({ setup })         => /* … */);
editor.on("mode-change", ({ mode })          => /* … */);
editor.on("docx:import", ({ warnings })      => /* … */);
editor.on("docx:export", ({ warnings })      => /* … */);
```

`on(...)` returns an unsubscribe.

### Undo / redo

The `editor.editor` escape hatch carries the `history` instance. See
[History API](/api/history/) for the full surface.

```ts
editor.editor.history.undo();
editor.editor.history.redo();
editor.editor.history.depth();             // { undo: 4, redo: 0 }
editor.editor.history.on("change", (depth) => /* … */);
```

Or via the command bus:

```ts
editor.commands.execute("history.undo");
editor.commands.execute("history.redo");
```

### Embedding fonts

```ts
const result = editor.editor.embedFont("Inter", {
  regular: interRegularBytes,  // Uint8Array (TTF / OTF)
  bold: interBoldBytes,
});
if (result.warnings.length) console.warn(result.warnings);

editor.editor.removeEmbeddedFont("Inter");
```

The renderer auto-registers `@font-face` rules for embedded faces.
Refused (with a warning) when OS/2 `fsType` marks a face as
embedding-restricted, unless `{ allowRestricted: true }` is passed.
See [Fonts API](/api/fonts/) for full details on `fontTable.xml`
round-trip + ODTTF obfuscation.

### Save / load `.docx`

```ts
function save() {
  const { blob } = editor.toDocx();
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: "out.docx" }).click();
  URL.revokeObjectURL(url);
}

async function open(file: File) {
  const { warnings } = await editor.loadDocx(file);
  if (warnings.length) console.warn(warnings);
}
```

`toDocx()` and `loadDocx()` return warnings in-band — no need to subscribe
to `docx:import` / `docx:export`.

### Commands

`editor.commands` is the same `CommandBus` the keyboard plugin and the
toolbar dispatch through. See the [Editor reference](/api/editor/#commands)
for the full list and how to register your own.

```ts
editor.commands.execute("mark.toggle.bold");
editor.commands.execute("section.insertBreakAfter");
```

## Y.Doc + collaboration

The document is backed by a [Yjs](https://yjs.dev) `Y.Doc`. The editor
mirrors every mutation into it inside a `Y.Doc.transact` (origin
`"local"`). Embedders attach Yjs providers to add persistence or
real-time collaboration:

```ts
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";

const ydoc = new Y.Doc();
new IndexeddbPersistence("doc-q2-brief", ydoc);   // local persistence

const editor = createSobree("#editor", { ydoc });
// `editor.ydoc === ydoc` — the same reference.
```

When you don't pass a `ydoc`, the editor creates one internally —
still observable via `editor.ydoc` for inspection / dev tools.

### Schema

The Y.Doc has a documented top-level layout (see
`@sobree/core/ydoc/schema.ts`):

```
ydoc
├── getArray("body")  : Y.Array<Y.Map>     — block list, one Y.Map per block
├── getMap("meta")    : Y.Map              — sections, styles, numbering, …
└── getMap("parts")   : Y.Map<Uint8Array>  — binary parts (images, fonts)
```

Block Y.Maps come in two shapes:

**Paragraph blocks** — char-level CRDT:

```
paragraphMap
├── get("id")    : string         — stable peer-prefixed block id
├── get("kind")  : "paragraph"    — discriminator
├── get("text")  : Y.Text         — runs flatten into here; marks for run
│                                   properties; embed objects for breaks /
│                                   tabs / fields / drawings; `link: { href }`
│                                   mark for hyperlink chars
└── get("props") : string (JSON)  — ParagraphProperties (alignment, indent, …)
```

**Other blocks** (section breaks, tables) — JSON-encoded:

```
otherBlockMap
├── get("id")    : string         — stable block id
└── get("_ast")  : string (JSON)  — JSON-encoded Block
```

Two peers concurrently editing different positions of the same
paragraph **merge correctly**. The smart Y.Text diff in
`applyDocumentToYDoc` emits minimal `insert` / `delete` / `format`
operations — Yjs's CRDT handles the rest.

Tables and section breaks remain JSON-encoded — they have no inline
content to merge concurrently. Tables are not yet backed by their own
per-cell CRDT type.

### Multi-peer collaboration

The Y.Doc is the wire — there is no separate RPC layer. Every peer,
including agents and automation, participates by sharing the same
Y.Doc through providers or [`HeadlessSobree`](/api/headless/).

- **Block- and char-level CRDT.** Concurrent edits to different blocks
  merge cleanly, and paragraph blocks back their content with `Y.Text`
  (marks for run properties, embeds for non-text runs), so concurrent
  edits to different positions of the *same* paragraph merge correctly.
  Peers joining an active room adopt its existing state; `BlockRegistry`
  ids are prefixed by `ydoc.clientID` so two peers can't mint the same id.
- **Per-peer undo.** `History` is a thin wrapper around `Y.UndoManager`.
  Each peer's `Cmd+Z` reverses only its own edits (via `trackedOrigins`);
  remote edits flow through but aren't on the local undo stack. Selection
  restore rides on `stackItem.meta`. See [History API](/api/history/).
- **Providers.** `@sobree/collab-providers` ships
  `attachWebsocketProvider` / `attachIndexedDBProvider` /
  `attachWebRTCProvider` plus an in-memory `loopback()`, and
  `attachPresence` / `attachPresenceOverlay` for remote cursors and
  selection highlights.
- **Server.** `@sobree/collab-server` is a Node-only y-protocol relay
  and persister with filesystem and in-memory persistence backends.
  It supports read-only peers — `onConnection` can return
  `{ allow: true, write: false }` — and sends a session message
  (`{ isEmpty, isWritable, peerCount }`) immediately on connect so
  clients can run leader election and decide whether to seed
  `initialDocument`.
- **Content-hashed binary parts.** Pass a `blobStore` and the editor
  migrates pasted images and embedded fonts to the side-channel store;
  the Y.Doc carries hashes via a `partRefs` Y.Map.
  `editor.ensurePartsLoaded()` pre-fetches before `toDocx()` when
  needed. See [BlobStore](/api/blob/).
- **Agents.** `@sobree/mcp` is an MCP server wrapping `HeadlessSobree`
  that exposes Sobree's mutations as LLM-friendly tools: `get_document`,
  `get_outline`, `insert_paragraph_after`, `insert_paragraph_before`,
  `replace_paragraph`, `delete_block`, `undo`, and `redo`.

## Plugins

Plugins are objects with `{ name?, setup(ctx) → { destroy } }`. The
factory loops over `options.plugins` in order, calls `setup(ctx)` on
each (where `ctx = { editor, sobree, viewport, host }`), and stores
the destroyers. On `destroy()` they run in reverse-of-mount order
(LIFO).

```ts
import * as Y from "yjs";
import { createSobree } from "@sobree/core";
import { keyboard } from "@sobree/keyboard";
import { attachWebsocketProvider } from "@sobree/collab-providers";

const ydoc = new Y.Doc();
await (await attachWebsocketProvider(ydoc, {
  url: "wss://collab.example.com",
  room: "doc-123",
  name: "Alice",
})).synced;

const editor = createSobree("#editor", {
  ydoc,
  plugins: [keyboard()],
});
```

A plugin whose `setup()` throws is logged and skipped — its peers
still mount. See [Plugin model](/concepts/plugins/) for the contract
and [Building your own plugin](/plugins/build-your-own/) for
authoring guidance.

## Going off-piste

If you need custom layout, multiple editors sharing a viewport, or
non-default zoom config, every class still ships individually — skip
the factory:

```ts
import { Sobree, Viewport } from "@sobree/core";
import { BlockTools } from "@sobree/block-tools";
import { attachKeyboard } from "@sobree/keyboard";

const viewport = new Viewport(host, { minScale: 0.5 });
const sobree   = new Sobree(viewport.slot, { /* … */ });
const tools    = new BlockTools({
  stackRoot: sobree.stackRoot,
  editor: sobree.editor,
  renderingArea: host,
  viewport,
  getSetup: () => sobree.getPageSetup(),
  setSetup: (next) => sobree.setPageSetup(next),
});
const detachKeyboard = attachKeyboard(sobree.editor);
```

`createSobree` composes these same primitives in this order; see the
source for the exact wiring.

## Lifecycle

`destroy()` tears down everything `createSobree()` mounted, in
reverse-of-mount order:

- Each plugin's `destroy()`, in **LIFO** order. (A plugin's destroy
  that throws is logged but doesn't stop peers.)
- `Sobree`, which cascades into `Editor.destroy()`. That removes:
  - All `editor.on(...)` listeners + the `selectionchange` /
    `beforeinput` / `keydown` / `input` host listeners.
  - The History layer (clears stacks, cancels typing-session timer).
  - The font-face registry (revokes blob URLs, removes the owned
    `<style>` tag).
  - The image-resize affordance.
  - The paper stack.

The viewport doesn't currently expose a `destroy()` method — its
listeners go when the host element is removed from the DOM. The
`host` element you passed in still exists; replace its children if
you want to reuse it.

If you want to reset history without destroying the editor, use
`editor.editor.history.clear()`. If you want to drop unused image /
font parts from `rawParts` (in-memory), use
`editor.editor.pruneUnusedParts()`.
