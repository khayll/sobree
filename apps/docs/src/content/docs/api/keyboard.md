---
title: "@sobree/keyboard"
description: Default keyboard shortcuts plugin for the Sobree editor.
---

`@sobree/keyboard` is a thin plugin that maps standard Cmd / Ctrl
shortcuts to commands on the editor's command bus. It registers no
commands of its own — every command it dispatches (`history.undo`,
`mark.toggle.bold`, `section.insertBreakAfter`, …) is registered by
`@sobree/core` itself, so disabling this plugin doesn't break toolbar
buttons or programmatic dispatch.

## Install

```sh
pnpm add @sobree/core @sobree/keyboard
```

`@sobree/core` is a peer dependency. `createSobree()` doesn't auto-mount
any stock plugin — install the ones you want and pass their factories
in `plugins: []`.

## Mount via `createSobree`

```ts
import { createSobree } from "@sobree/core";
import { keyboard } from "@sobree/keyboard";

createSobree("#editor", {
  plugins: [keyboard()],
});

// With custom bindings layered on top of the defaults:
createSobree("#editor", {
  plugins: [keyboard({ bindings: [/* ... */] })],
});
```

## Default bindings

| Combo                          | Command                       |
| ------------------------------ | ----------------------------- |
| Cmd / Ctrl + Z                 | `history.undo`                |
| Cmd / Ctrl + Shift + Z         | `history.redo` (macOS-style)  |
| Cmd / Ctrl + Y                 | `history.redo` (Windows-style) |
| Cmd / Ctrl + Shift + Enter     | `section.insertBreakAfter`    |
| Cmd / Ctrl + B                 | `mark.toggle.bold`            |
| Cmd / Ctrl + I                 | `mark.toggle.italic`          |
| Cmd / Ctrl + U                 | `mark.toggle.underline`       |
| Cmd / Ctrl + Shift + S         | `mark.toggle.strike`          |
| Cmd / Ctrl + .                 | `mark.toggle.superscript`     |
| Cmd / Ctrl + ,                 | `mark.toggle.subscript`       |

## Direct usage (without `createSobree`)

For embedders who instantiate `Sobree` themselves — `attachKeyboard`
is the lower-level entry point the `keyboard()` factory wraps.

```ts
import { Sobree } from "@sobree/core";
import { attachKeyboard } from "@sobree/keyboard";

const sobree = new Sobree(host);
const detach = attachKeyboard(sobree.editor);
// …
detach();
```

## Options

```ts
interface KeyboardOptions {
  bindings?: KeyBinding[];
}

interface KeyBinding {
  match: (e: KeyDownPayload) => boolean;
  command: string;
}
```

User bindings are appended to the default list, but matched in reverse
order — so a user binding for `Cmd+B` shadows the default `mark.toggle.bold`
binding. To replace the defaults entirely, ignore `DEFAULT_BINDINGS`
and pass your own complete list.

## Custom bindings example

```ts
import { attachKeyboard } from "@sobree/keyboard";

attachKeyboard(editor, {
  bindings: [
    // Cmd + / opens a search palette.
    {
      match: (e) => (e.ctrl || e.meta) && !e.shift && !e.alt && e.key === "/",
      command: "palette.open",
    },
    // Override Cmd + B with a custom command.
    {
      match: (e) => (e.ctrl || e.meta) && !e.shift && !e.alt && e.key === "b",
      command: "my.custom.bold",
    },
  ],
});
```

The custom command must be registered on the editor's command bus
(`editor.commands.register({...})`) before it's dispatched, or
`commands.execute(...)` will warn.

## `KeyDownPayload`

The `match` predicate receives the editor's `KeyDownPayload`:

```ts
interface KeyDownPayload {
  key: string;       // e.g. "b", "Enter", "ArrowDown"
  code: string;      // e.g. "KeyB", "Enter"
  ctrl: boolean;
  meta: boolean;     // Cmd on macOS
  shift: boolean;
  alt: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  originalEvent: KeyboardEvent;
}
```

The plugin calls `preventDefault()` + `stopPropagation()` automatically
on every match. Don't call them yourself.

## Why the indirection?

The plugin doesn't own commands — it's pure dispatch. That keeps the
mapping declarative (the bindings table is the entire spec) and makes
toolbars / agents / MCP work even when the keyboard plugin is disabled.

A consumer who doesn't mount `keyboard()` keeps:

- `editor.commands.execute("history.undo")` (programmatic dispatch)
- toolbar buttons that dispatch via `commands.execute(...)`
- `editor.history.undo()` (direct API)
- The `beforeinput` interception of the browser's native Cmd+Z (still
  routes through `history.undo` — protects the AST from desync)

…and only loses the keystroke→dispatch wiring.

## Related

- [Plugin model](/concepts/plugins/)
- [`createSobree()`](/api/create-sobree/) — `plugins` option
- [History API](/api/history/)
