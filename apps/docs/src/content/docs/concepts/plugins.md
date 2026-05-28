---
title: Plugin model
description: Events, the command bus, and the SobreePlugin contract.
---

Sobree's editor binds zero shortcuts and exposes zero UI. Everything
embedder-visible is a plugin — and every plugin uses the same three
mechanisms.

## The three mechanisms

### 1. Events

The editor exposes typed events via `editor.on(...)`:

```ts
editor.on("change",    (payload) => { /* document mutated */ });
editor.on("selection", (payload) => { /* cursor / range moved */ });
editor.on("keydown",   (payload) => { /* key pressed in the host */ });
```

Each `on(...)` call returns an unsubscribe.

`change` carries the full `SobreeDocument` and a monotonic revision.
`selection` carries the model range / caret / block. `keydown` carries
normalised modifier flags plus `preventDefault()` and `stopPropagation()`
proxies — subscribers can intercept keys without touching DOM events
directly.

### 2. Commands

Named operations live on `editor.commands`:

```ts
editor.commands.register({
  name: "mark.toggle.bold",
  title: "Bold",
  run: () => { /* toggle bold on the selection */ },
  isActive: () => /* true when caret is inside bold text */,
  isAvailable: () => /* false when execution would no-op */,
});

editor.commands.execute("mark.toggle.bold");
editor.commands.list();   // [{ name, title, isActive, isAvailable }, ...]
editor.commands.has("mark.toggle.bold");
```

The command bus is the **single coordination point** between plugins.
Keyboard shortcuts dispatch through it; toolbar buttons dispatch through
it. A future command palette plugin would, too. (For multi-peer
collab, the same commands run locally on each peer and the resulting
Y operations propagate via Y-protocol — no separate RPC layer
needed.)

### 3. The plugin object

A plugin is an object with a `setup(ctx)` method that returns a destroyer:

```ts
interface SobreePlugin {
  /** Diagnostic name surfaced in setup-failure logs. Optional. */
  name?: string;
  /** Mount the plugin against the editor surface. */
  setup(ctx: PluginContext): { destroy: () => void };
}

interface PluginContext {
  editor: Editor;
  sobree: Sobree;
  viewport: Viewport;
  host: HTMLElement;
}
```

`setup` runs on `createSobree()` mount; the returned `destroy()` runs
on `editor.destroy()`. Plugins typically ship as **factory functions**
that return a `SobreePlugin` — that's what the stock packages do:

```ts
import type { Editor, SobreePlugin } from "@sobree/core";

export function autosave(opts: { url: string }): SobreePlugin {
  return {
    name: "autosave",
    setup({ editor }) {
      const off = editor.on("change", ({ doc }) => {
        fetch(opts.url, { method: "POST", body: JSON.stringify(doc) });
      });
      return { destroy: off };
    },
  };
}

createSobree("#editor", {
  plugins: [autosave({ url: "/api/save" })],
});
```

Plugins layer on top of the always-on internals. Destroy order is
reverse of setup order — last-on, first-off.

## What ships in the box

| layer                                                  | what it does                                                                          |
|--------------------------------------------------------|---------------------------------------------------------------------------------------|
| `attachSections` (in core)                             | Registers `section.insertBreakAfter`. Always on.                                      |
| Mark + history commands (in core)                      | `mark.toggle.bold` … and `history.undo` / `history.redo` registered on the bus. Always on — drives toolbars, keyboard, agents from one source. |

`@sobree/core` ships with **no UI plugins and no shortcuts**.
Install the ones you want and pass them to
`createSobree({ plugins: [] })`:

| package                                                | factory          | what it does                                                                    |
|--------------------------------------------------------|------------------|---------------------------------------------------------------------------------|
| [`@sobree/keyboard`](/api/keyboard/)                   | `keyboard()`     | Default Cmd / Ctrl shortcuts → command bus. Pure key→command mapping, registers no commands. |
| [`@sobree/block-tools`](/api/block-tools/)             | `blockTools()`   | Floating block toolbar UI + gutter indicator + zone editor.                     |
| [`@sobree/zoom-controls`](/api/zoom-controls/)         | `zoomControls()` | Floating zoom dock (fit page / fit width / − / +).                              |

For multi-peer collab there's no separate RPC plugin — the Y.Doc IS
the wire. Attach a Yjs provider from
[`@sobree/collab-providers`](/api/collab-providers/) and edits
propagate to other peers via Y-protocol. Headless code peers (LLMs,
automation) participate through [`HeadlessSobree`](/api/headless/)
on the same Y.Doc.

The mark + history commands stay on the bus regardless of which
plugins are mounted — so a headless caller can still
`editor.commands.execute("history.undo")` even with no keyboard
plugin.

## Mounting plugins

```ts
import { createSobree } from "@sobree/core";
import { keyboard } from "@sobree/keyboard";
import { blockTools } from "@sobree/block-tools";
import { zoomControls } from "@sobree/zoom-controls";

const editor = createSobree("#editor", {
  plugins: [
    keyboard(),
    blockTools(),
    zoomControls(),
  ],
});
```

`setup` runs in array order; `destroy` runs in reverse on
`editor.destroy()`. A plugin whose `setup()` throws is logged and
skipped — its peers still mount.

A multi-peer setup attaches a Yjs provider to the editor's `Y.Doc`
instead of adding a wire plugin:

```ts
import * as Y from "yjs";
import { createSobree } from "@sobree/core";
import { attachWebsocketProvider } from "@sobree/collab-providers";

const ydoc = new Y.Doc();
await (await attachWebsocketProvider(ydoc, {
  url: "wss://collab.example.com",
  room: "doc-123",
  name: "Alice",
})).synced;

const editor = createSobree("#editor", { ydoc, plugins: [/* … */] });
```

The Y provider IS the wire. No separate RPC plugin needed.

### Extending the keyboard plugin

The keyboard factory accepts a `bindings` array layered on top of the
defaults — last matcher wins, so user bindings shadow defaults of the
same combo:

```ts
createSobree("#editor", {
  plugins: [
    keyboard({
      bindings: [
        // Cmd+/ opens a search palette
        { match: (e) => (e.ctrl || e.meta) && e.key === "/", command: "palette.open" },
      ],
    }),
  ],
});
```

See [`@sobree/keyboard`](/api/keyboard/) for the full API.

:::tip
Writing your own plugin? Start at
[Building your own plugin](/plugins/build-your-own/) for the cookbook —
the contract, anti-patterns, a worked save-indicator example, and
shipping options (in-app, factory in `plugins: []`, sibling package).
:::

## A worked example: the keyboard plugin

The keyboard plugin is small. It demonstrates the whole contract — a
factory that returns a `SobreePlugin`, registering commands and
mapping keys to them inside `setup`:

```ts
import type { KeyDownPayload, SobreePlugin } from "@sobree/core";
import { rangeAtSelection, toggleMark } from "@sobree/core";

export function keyboard(): SobreePlugin {
  return {
    name: "keyboard",
    setup({ editor }) {
      // 1. Register commands so other plugins can also call them.
      const detachCommands = [
        editor.commands.register({
          name: "mark.toggle.bold",
          run: () => toggleMark(editor, rangeAtSelection(editor), "bold"),
          isActive: () => /* …check bold state… */,
        }),
        // …etc for italic / underline / strike / sup / sub…
      ];

      // 2. Subscribe to keydown; map combos to command names.
      const detachKeydown = editor.on("keydown", (e: KeyDownPayload) => {
        const cmd = e.ctrl || e.meta;
        if (!cmd) return;
        let name: string | null = null;
        if (e.key === "b") name = "mark.toggle.bold";
        else if (e.key === "i") name = "mark.toggle.italic";
        // …etc
        if (name) {
          e.preventDefault();
          editor.commands.execute(name);
        }
      });

      // 3. Return a destroyer that unwinds both.
      return {
        destroy: () => {
          detachKeydown();
          for (const off of detachCommands) off();
        },
      };
    },
  };
}
```

Three properties of this design worth pointing at:

1. **Keyboard never calls helpers directly.** It calls
   `editor.commands.execute("mark.toggle.bold")`. That means the toolbar's
   bold button, an external WebSocket caller, and Ctrl+B all run the same
   code — there's no second source of truth for "what does bold do?".

2. **Commands are introspectable.** `editor.commands.list()` returns every
   registered command with current `isActive` / `isAvailable`. The toolbar
   uses this to paint pressed / disabled states; a command palette plugin
   would use it as its data source.

3. **No knowledge leaks.** Editor doesn't know about Ctrl+B. Keyboard
   doesn't know about toolbars. Toolbar doesn't know about the wire. Each
   communicates only through events + commands.
