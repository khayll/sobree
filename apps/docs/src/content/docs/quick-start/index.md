---
title: Quick start
description: Install Sobree and get an editor on the page in five minutes.
---

`@sobree/core` is the minimal editor kernel — AST + paginator + DOCX
I/O + history + fonts + Y.Doc backing. It ships with **zero plugin
packages**. You install the plugins you want (toolbar, keyboard
shortcuts, zoom dock) and pass them to `createSobree()`.

Three setups cover most embedders. Pick the one that matches your
deployment model. **The browser code is identical across all
three** — only what you attach to the Y.Doc differs. See
[Architecture: deployment tiers](/concepts/architecture/#deployment-tiers).

## Example 1: solo editor (no server)

A user-facing editor with a floating toolbar, keyboard shortcuts, and
a zoom dock. Install the three stock UI plugins:

```sh
pnpm add @sobree/core @sobree/keyboard @sobree/block-tools @sobree/zoom-controls
```

Mount it:

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
  console.log("body has", doc.body.length, "blocks");
});
```

That's it — the user can type, click the indicator to open the toolbar,
press Cmd+Z, click the zoom buttons, etc. Importing
`@sobree/core/tokens.css` once gives the brand visuals (amber primary,
warm-ink neutrals, motion / radii / shadows). Reload loses state — add
`@sobree/collab-providers`'s `attachIndexedDBProvider` for local
persistence.

## Example 2: editor + a code peer (LLM agent / automation)

Your browser editor and a Node-side code peer share the same Y.Doc.
The code peer uses `HeadlessSobree` — same mutation API, no DOM —
and they sync via any Y provider.

```sh
pnpm add @sobree/core @sobree/keyboard @sobree/block-tools @sobree/collab-providers
```

Browser side (same plugins as Example 1, plus a Y provider):

```ts
import * as Y from "yjs";
import { createSobree } from "@sobree/core";
import { keyboard, blockTools } from "...";  // same as Example 1
import { attachWebsocketProvider } from "@sobree/collab-providers";

const ydoc = new Y.Doc();
const provider = await attachWebsocketProvider(ydoc, {
  url: "ws://localhost:1234",
  room: "doc-q2-brief",
  name: "Alice",
});
await provider.synced;

const editor = createSobree("#editor", {
  ydoc,
  plugins: [keyboard(), blockTools()],
});
```

LLM peer (Node):

```ts
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { HeadlessSobree, paragraph, text } from "@sobree/core";

const ydoc = new Y.Doc();
const provider = new WebsocketProvider(
  "ws://localhost:1234", "doc-q2-brief", ydoc,
);
await new Promise((r) => provider.once("sync", r));

const sobree = new HeadlessSobree(ydoc, { origin: "agent" });

// Read structure
sobree.on("change", ({ doc, local }) => {
  if (!local) console.log("human typed; new state:", doc.body.length, "blocks");
});

// Make an edit — propagates to the human's editor via Y
const last = sobree.getBlock(sobree.getBlocks().length - 1);
sobree.insertBlockAfter(
  { id: last.id, version: last.version },
  paragraph([text("Added by the agent.")]),
);
```

For the WebSocket relay between them, run `@sobree/collab-server` (or
use `y-webrtc` for serverless peer-to-peer). The dev playground does
this via `pnpm dev:collab`.

## Example 3: multi-user collaboration

Same browser code as Example 2 — point the provider at your hosted
collab-server instead of localhost. Authentication via the server's
`onConnection` hook. See
[`@sobree/collab-server`](https://docs.sobree.dev/api/collab-server/).

## Pick your starting content

The `content` option is polymorphic — pass whatever you have:

```ts
// 1. A markdown string (seed-quality only — see "Markdown subset" below)
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

## Save and load `.docx`

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

## Undo / redo

When you mount [`@sobree/keyboard`](/api/keyboard/), `Cmd+Z` / `Ctrl+Z`
undoes; `Cmd+Shift+Z` / `Ctrl+Y` redoes. Typing within a ~1 second
window collapses into a single undo step (Word-style coalescing). The
cursor is restored to its pre-edit position.

The history layer itself lives in `@sobree/core` — programmatic API
works regardless of whether the keyboard plugin is mounted:

```ts
editor.editor.history.undo();      // returns true if a step was applied
editor.editor.history.redo();
editor.editor.history.canUndo();
editor.editor.history.depth();     // { undo: 4, redo: 0 }
```

Or via the command bus:

```ts
editor.commands.execute("history.undo");
editor.commands.execute("history.redo");
```

See the [History API](/api/history/) for memory-bound configuration.

## Customising the keyboard shortcuts

The `keyboard()` factory takes an optional `bindings` array layered on
top of the defaults — last matcher wins, so user bindings shadow
defaults of the same combo:

```ts
createSobree("#editor", {
  plugins: [
    keyboard({
      bindings: [
        { match: (e) => (e.ctrl || e.meta) && e.key === "/", command: "palette.open" },
      ],
    }),
  ],
});
```

See [`@sobree/keyboard`](/api/keyboard/) for the full API.

## Markdown subset

The markdown string accepted by `content` (and `editor.loadMarkdown`)
is **for seeding example content**, not a real Markdown processor.
Supported: ATX headings (`#`–`######`), paragraphs, bold (`**...**`),
italic (`*...*`, `_..._`), inline code, links (`[text](url)`),
single-level bulleted (`-`, `*`) and numbered (`1.`) lists, two-space
hard breaks. Tables, blockquotes, code fences, images, and nested
lists are out of scope — use the AST builders for those.

## Going off-piste

If you need to wire `Viewport` / `Sobree` / `BlockTools` yourself —
custom layout, multiple editors sharing a viewport, non-default zoom
config — every class still ships individually from its package:

```ts
import { Sobree, Viewport, emptyDocument } from "@sobree/core";
import { BlockTools } from "@sobree/block-tools";
import { attachKeyboard } from "@sobree/keyboard";

const viewport = new Viewport(host);
const sobree = new Sobree(viewport.slot, { initialDocument: emptyDocument() });
new BlockTools({
  stackRoot: sobree.stackRoot,
  editor: sobree.editor,
  renderingArea: host,
  viewport,
  getSetup: () => sobree.getPageSetup(),
  setSetup: (next) => sobree.setPageSetup(next),
});
attachKeyboard(sobree.editor);
```

`createSobree()` composes these same primitives — see the source if
you want to fork.

## Next

- **[Architecture](/concepts/architecture/)** — the layering and why each
  piece is separate.
- **[Plugin model](/concepts/plugins/)** — what's in the box and how
  plugins coordinate.
- **[Building your own plugin](/plugins/build-your-own/)** — write +
  ship a plugin against the SobreePlugin contract.
- **[API reference](/api/create-sobree/)** — every exported symbol,
  type, event.
