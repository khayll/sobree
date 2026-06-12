---
title: Building your own plugin
description: Write a plugin against the Sobree editor — events, commands, the SobreePlugin contract.
---

A Sobree plugin is an object with a `setup(ctx)` method that mounts
the plugin and returns a `destroy()` callback. That's the whole
contract. Everything else — event subscriptions, command
registrations, DOM ownership, transports — is something you do
*inside* `setup` using the editor's public API.

The stock plugins (`@sobree/keyboard`, `@sobree/block-tools`,
`@sobree/zoom-controls`) all follow this exact shape. Yours should too. See [Plugin model](/concepts/plugins/) for
the underlying mechanics; this page is the cookbook.

## The contract

```ts
import type { Editor, Sobree, Viewport, SobreePlugin } from "@sobree/core";

interface SobreePlugin {
  /** Diagnostic name surfaced in setup-failure logs. Optional. */
  name?: string;
  /** Mount the plugin against the editor surface. Returns a destroyer. */
  setup(ctx: PluginContext): { destroy: () => void };
}

interface PluginContext {
  editor: Editor;
  sobree: Sobree;
  viewport: Viewport;
  host: HTMLElement;
}
```

`createSobree({ plugins: [...] })` calls `setup(ctx)` once per plugin
in array order, stores the destroyers, and runs them in **reverse**
on `editor.destroy()` (LIFO).

Plugins are **opaque** after handoff — once mounted, the embedder
doesn't reach back in. If your plugin needs to expose external methods
(e.g. an autosave plugin's `flush()`), return a richer object that's
still a valid `SobreePlugin` — see the autosave example below.

## A minimal plugin: a word counter

```ts
import type { SobreePlugin } from "@sobree/core";

export interface WordCounterOptions {
  badge: HTMLElement;
}

export function wordCounter(opts: WordCounterOptions): SobreePlugin {
  return {
    name: "word-counter",
    setup({ editor }) {
      const update = () => {
        const text = editor.getDocument().body
          .filter((b) => b.kind === "paragraph")
          .map((p) =>
            p.runs.filter((r) => r.kind === "text").map((r) => r.text).join(""),
          )
          .join(" ");
        opts.badge.textContent = `${text.split(/\s+/).filter(Boolean).length} words`;
      };
      const off = editor.on("change", update);
      update();
      return { destroy: off };
    },
  };
}
```

Mount it via `createSobree`:

```ts
const badge = document.querySelector<HTMLElement>("#word-count")!;
createSobree("#editor", {
  plugins: [wordCounter({ badge })],
});
```

## A class-backed plugin with options

For plugins with lifecycle and configuration — autosave, presence
indicators, custom toolbars — wrap a class in the factory.

```ts
import type { Editor, SobreePlugin } from "@sobree/core";

export interface AutosaveOptions {
  url: string;
  /** Debounce ms between save calls. Default 500. */
  debounceMs?: number;
}

class AutosaveImpl {
  private readonly editor: Editor;
  private readonly url: string;
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private detach: (() => void) | null = null;

  constructor(editor: Editor, opts: AutosaveOptions) {
    this.editor = editor;
    this.url = opts.url;
    this.debounceMs = opts.debounceMs ?? 500;
    this.detach = editor.on("change", () => this.schedule());
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.detach?.();
    this.detach = null;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.save();
    }, this.debounceMs);
  }

  private async save(): Promise<void> {
    await fetch(this.url, {
      method: "POST",
      body: JSON.stringify(this.editor.getDocument()),
    });
  }
}

export function autosave(opts: AutosaveOptions): SobreePlugin {
  return {
    name: "autosave",
    setup({ editor }) {
      const impl = new AutosaveImpl(editor, opts);
      return { destroy: () => impl.destroy() };
    },
  };
}

createSobree("#editor", {
  plugins: [autosave({ url: "/api/save" })],
});
```

### Exposing methods on a plugin

If callers need to invoke a method on the plugin (e.g.
`autosave.flush()`), return a richer object — it's still a valid
`SobreePlugin`:

```ts
export interface AutosavePlugin extends SobreePlugin {
  flush(): Promise<void>;
}

export function autosave(opts: AutosaveOptions): AutosavePlugin {
  let impl: AutosaveImpl | null = null;
  return {
    name: "autosave",
    setup({ editor }) {
      impl = new AutosaveImpl(editor, opts);
      return { destroy: () => { impl?.destroy(); impl = null; } };
    },
    flush() {
      return impl?.flushNow() ?? Promise.resolve();
    },
  };
}

const a = autosave({ url: "/api/save" });
createSobree("#editor", { plugins: [a] });
// Later, force a save:
await a.flush();
```

The first three stock plugins (keyboard, block-tools, zoom-controls)
don't need this — they're fully self-managing. Use the pattern only
when you have a real external method to expose.

## Three things to do well

### 1. Use `editor.commands`, not internal calls

The command bus is the **single coordination point** between plugins.
Toolbar buttons, keyboard shortcuts, MCP / agent calls (via
`HeadlessSobree`) — they all dispatch through `editor.commands.execute(name)`.
If your plugin adds new operations, register them as commands; if it
invokes operations, do it via `commands.execute`.

```ts
// ✅ Good — plugin defines a command, anything can dispatch it.
editor.commands.register({
  name: "myPlugin.foo",
  title: "Do the foo thing",
  run: () => { /* ... */ },
  isActive: () => /* ... */,
  isAvailable: () => /* ... */,
});

// Later (from your plugin's keystroke / button / event):
editor.commands.execute("myPlugin.foo");

// ❌ Bad — plugin reaches around the bus, breaking the
// "one dispatch path" property other plugins rely on.
editor.applyRunProperties(/* … */);
```

### 2. Listen via `editor.on`, not `document.addEventListener`

The editor funnels selectionchange / keydown / change / paginate /
mode-change into typed events with payloads. Subscribing through
`editor.on(...)` means your plugin shares the editor's single
document-level listener (no fights for ordering, no leaks if the host
is moved).

```ts
// ✅ Good
editor.on("selection", (payload) => { /* ... */ });
editor.on("change", ({ doc, revision }) => { /* ... */ });

// ❌ Bad — bypasses the editor's debouncing + funneling
document.addEventListener("selectionchange", /* … */);
```

### 3. Always return a clean detacher

Your plugin's lifecycle ends when the embedder calls `editor.destroy()`
or removes your plugin. Return a function that undoes everything:
remove listeners, clear timers, revoke blob URLs, remove DOM nodes
your plugin created.

```ts
return () => {
  off();                           // editor event subscription
  document.removeEventListener("…", handler); // any global listeners you added
  if (timer) clearTimeout(timer);
  myDomElement?.remove();
  for (const url of blobUrls) URL.revokeObjectURL(url);
};
```

## Shipping options

1. **As a one-off after `createSobree()`.** Subscribe to events
   directly on the returned handle and manage the detacher yourself.
   Zero ceremony — appropriate when no one else needs this plugin and
   it's a few lines.

2. **As a `SobreePlugin` in `plugins: []`.** Wrap the code in a
   factory that returns `{ name?, setup(ctx) → { destroy } }`.
   Mounted by `createSobree()` so destroy runs automatically on
   `editor.destroy()`. The right default for anything non-trivial.

3. **As a sibling npm package.** When the plugin is reusable across
   apps, ship it as `@my-org/sobree-foo` mirroring the `@sobree/*`
   package layout (see [block-tools](/api/block-tools/) or
   [zoom-controls](/api/zoom-controls/) for templates). Peer-depend on
   `@sobree/core`. Add `keywords: ["sobree", "plugin"]` to your
   `package.json` so npm search finds it.

## A worked example end-to-end

A read-only "save indicator" plugin that subscribes to `change`,
shows "Saving…", and clears once a save completes. Demonstrates
events + commands + DOM ownership + clean teardown.

```ts
import type { SobreePlugin } from "@sobree/core";

export interface SaveIndicatorOptions {
  /** Async save function called on every change. */
  save: (doc: unknown) => Promise<void>;
  /** Debounce window in ms. Default 800. */
  debounceMs?: number;
}

export function saveIndicator(opts: SaveIndicatorOptions): SobreePlugin {
  return {
    name: "save-indicator",
    setup({ editor, host }) {
      const pill = document.createElement("div");
      pill.className = "save-indicator";
      pill.style.cssText = `
        position: absolute; right: 12px; top: 12px;
        padding: 4px 10px; border-radius: 12px;
        background: rgba(0,0,0,0.06); font-size: 12px;
        color: #555; transition: opacity 200ms; opacity: 0;
      `;
      host.appendChild(pill);

      let timer: ReturnType<typeof setTimeout> | null = null;
      let inFlight = 0;

      const setLabel = (text: string, fade: boolean) => {
        pill.textContent = text;
        pill.style.opacity = fade ? "0" : "1";
      };

      const off = editor.on("change", ({ doc }) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          timer = null;
          inFlight += 1;
          setLabel("Saving…", false);
          try {
            await opts.save(doc);
          } catch {
            setLabel("Save failed", false);
            return;
          } finally {
            inFlight -= 1;
          }
          if (inFlight === 0) {
            setLabel("Saved", false);
            setTimeout(() => setLabel("Saved", true), 1200);
          }
        }, opts.debounceMs ?? 800);
      });

      return {
        destroy: () => {
          if (timer) clearTimeout(timer);
          off();
          pill.remove();
        },
      };
    },
  };
}

// Mount:
createSobree("#editor", {
  plugins: [
    saveIndicator({
      save: (doc) =>
        fetch("/api/save", { method: "POST", body: JSON.stringify(doc) }).then(),
    }),
  ],
});
```

The plugin reads `host` from the `PluginContext` instead of asking the
caller to pass an element — the host is the element `createSobree()`
mounted into, which is exactly where the indicator wants to live.

## Anti-patterns

| Don't | Why |
| --- | --- |
| Reach into `editor.doc` directly | Use `editor.getDocument()` — the AST may be DOM-dirty until ensureCurrent() runs. |
| Mount global DOM (`document.body.appendChild(...)`) without revoking on destroy | Plugin instances accumulate, leaking. |
| Bind keyboard shortcuts via `document.addEventListener("keydown", ...)` | Bypasses the editor's funnel — subscribe to `editor.on("keydown", …)` instead and shadow / extend `@sobree/keyboard`'s bindings. |
| Wrap a third-party framework's reactive primitives around the editor | Use `editor.on("change", …)` — its debouncing already does what reactive subscriptions would do, and it stays framework-free. |
| Mutate the document and re-render it manually | The Editor owns rendering. Use `editor.setDocument(doc)` or one of the typed mutators. |

## Testing

Plugins are pure functions or small classes. Unit-test them with
vitest + jsdom (the `@sobree/core` setup is in `vitest.setup.ts` —
mirror it). Stub the Editor:

```ts
import { describe, it, expect, vi } from "vitest";
import type { Editor, PluginContext } from "@sobree/core";

it("registers the foo command on setup", () => {
  const register = vi.fn();
  const editor = {
    commands: { register },
    on: () => () => {},
    getDocument: () => ({ body: [] }),
  } as unknown as Editor;
  const ctx = { editor } as PluginContext;
  const inst = foo().setup(ctx);
  expect(register).toHaveBeenCalledWith(
    expect.objectContaining({ name: "myPlugin.foo" }),
  );
  inst.destroy();
});
```

For end-to-end coverage, mount a real Editor against a jsdom host —
see `packages/keyboard/src/keyboard.test.ts` for the canonical
pattern.

## The shared toolkit

Helpers core exports specifically for plugin authors (the stock
plugins are built on the same ones):

| export | role |
|---|---|
| `getFloatingCorner(host, placement)` | The shared floating-corner stack — one container per corner per host, so multiple plugins' docks (zoom controls, review panel, yours) stack instead of overlapping. `FloatingCornerPlacement` names the corner. |
| `resolveStyleCascade(doc, styleId)` | Resolve a style chain (basedOn …) to effective properties — what toolbar state should reflect for a paragraph's `styleId`. |
| `MARK_COMMAND_DEFS`, `isMarkActive`, `toggleMark` | The mark catalogue and helpers — see [Editor → Marks](/api/editor/). |

`setup(ctx)` returns a `SobreePluginInstance` — just `{ destroy() }`;
the factory-vs-class choice is yours.

## Related

- [Plugin model](/concepts/plugins/) — the underlying mechanics
- [`createSobree()` plugins option](/api/create-sobree/)
- [`@sobree/keyboard`](/api/keyboard/) — minimal `keyboard()` factory
- [`@sobree/block-tools`](/api/block-tools/) — class-backed UI plugin
