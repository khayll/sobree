# @sobree/core

Embeddable, print-view-first WYSIWYG editor for `.docx`. Framework-free
core, plugin architecture, native OOXML round-trip.

→ Docs: **[docs.sobree.dev](https://docs.sobree.dev)**
→ Live editor: **[sobree.dev/try](https://sobree.dev/try)**

## Install

`@sobree/core` is the **minimal editor kernel** — AST + paginator + DOCX
I/O + history + fonts. It ships with **zero plugin packages**. Install
the plugins you want and pass them to `createSobree()`.

For an interactive editor with toolbar, keyboard shortcuts, and zoom dock:

```sh
pnpm add @sobree/core @sobree/keyboard @sobree/block-tools @sobree/zoom-controls
```

For a headless / API-driven peer (LLM agent, automation):

```sh
pnpm add @sobree/core yjs
```

Use `HeadlessSobree` — the no-DOM counterpart of the browser editor.
For multi-user collab, add `@sobree/collab-providers` (client glue)
and run `@sobree/collab-server` somewhere.

## Hello world

```ts
import { createSobree } from "@sobree/core";
import { keyboard } from "@sobree/keyboard";
import { blockTools } from "@sobree/block-tools";
import { zoomControls } from "@sobree/zoom-controls";
import "@sobree/core/tokens.css";

const editor = createSobree("#editor", {
  content: "# Hello\n\nStart typing.",
  plugins: [
    keyboard(),       // Cmd+B / Cmd+Z / …
    blockTools(),     // floating toolbar + gutter indicator
    zoomControls(),   // bottom-right zoom dock
  ],
});

editor.on("change", ({ doc }) => {
  console.log("body has", doc.body.length, "blocks");
});
```

`createSobree()` mounts the viewport, the paginated paper stack, runs each
plugin's `setup()` against a shared context, and returns a single handle.
Plugins are torn down in reverse-of-mount order on `editor.destroy()`.

## What's in the box

- **Native OOXML AST.** Every node maps 1:1 to a `<w:…>` element.
- **Y.Doc backed.** Every editor is backed by a Yjs `Y.Doc`; mutations mirror in via `Y.Doc.transact`. Embedders attach `y-websocket` / `y-indexeddb` / `y-webrtc` providers for persistence + collaboration. `editor.ydoc` is the escape hatch.
- **Pure paginator.** TeX-style break selection, widow / orphan, keep-with-next, multi-section. No DOM, no I/O.
- **Per-peer undo / redo.** Thin wrapper around `Y.UndoManager` — each peer's `Cmd+Z` reverses only its own edits via tracked Y origins; remote edits flow through but stay off the local stack. Selection restored from `stackItem.meta`.
- **OOXML font embedding.** `word/fontTable.xml` round-trip + ODTTF obfuscation + OS/2 fsType licence check + runtime `@font-face` registration. Note: `fsType` is an advisory gate — the embedder is responsible for ensuring they have rights to ship any font they pass to `editor.embedFont(...)`. Pass `{ allowRestricted: true }` only when you do.
- **Minimal core, opt-in plugins.** Toolbar (`@sobree/block-tools`), keyboard (`@sobree/keyboard`), zoom dock (`@sobree/zoom-controls`) ship as siblings. For multi-user collab: `@sobree/collab-providers` (client) + `@sobree/collab-server` (Node relay). `@sobree/core` has no plugin dependencies — only `fflate` for ZIP and `yjs` for the CRDT.
- **Y-protocol IS the wire.** No separate RPC plugin. Headless callers (LLMs, automation) participate via `HeadlessSobree` — same commands, same Y.Doc.
- **Wire-ready surface.** `editor.commands.execute(name, args)` is the single dispatch path used by keyboard, toolbar, and external transports.
- **JSON-clean projection.** `editor.getDocument()` returns a JSON-clean `SobreeDocument` snapshot of the underlying Y.Doc — survives `structuredClone` and any wire.

## Polymorphic content

```ts
createSobree("#editor", { content: "# Markdown" });          // seed string
createSobree("#editor", { content: docxBlob });              // .docx bytes
createSobree("#editor", { content: astLiteral });            // built with the doc builders
createSobree("#editor");                                      // empty
```

For the `.docx` path, `await editor.ready` resolves once the import lands.

## Save back to `.docx`

```ts
const { blob } = editor.toDocx();
```

Or load a different file at runtime:

```ts
const { warnings } = await editor.loadDocx(file);
```

## Documentation

- [Quick start](https://docs.sobree.dev/quick-start/)
- [`createSobree()` API](https://docs.sobree.dev/api/create-sobree/)
- [History (undo / redo)](https://docs.sobree.dev/api/history/)
- [Fonts (embedding + fontTable)](https://docs.sobree.dev/api/fonts/)
- [Architecture](https://docs.sobree.dev/concepts/architecture/)
- [Document model](https://docs.sobree.dev/concepts/document/)
- [Plugin model](https://docs.sobree.dev/concepts/plugins/)
- [Building your own plugin](https://docs.sobree.dev/plugins/build-your-own/)

## License

MIT.
