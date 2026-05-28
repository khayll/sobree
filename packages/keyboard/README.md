# @sobree/keyboard

Default keyboard shortcuts for [`@sobree/core`](https://www.npmjs.com/package/@sobree/core). Opt-in plugin — install it and pass `keyboard()` to `createSobree({ plugins: [...] })`.

## Install

```sh
pnpm add @sobree/core @sobree/keyboard
```

`@sobree/core` is a peer dependency.

## Mount via `createSobree`

```ts
import { createSobree } from "@sobree/core";
import { keyboard } from "@sobree/keyboard";

createSobree("#editor", {
  plugins: [keyboard()],
});
```

## Default bindings

| Combo | Command |
| --- | --- |
| Cmd / Ctrl + Z | `history.undo` |
| Cmd / Ctrl + Shift + Z | `history.redo` (macOS-style) |
| Cmd / Ctrl + Y | `history.redo` (Windows-style) |
| Cmd / Ctrl + Shift + Enter | `section.insertBreakAfter` |
| Cmd / Ctrl + B | `mark.toggle.bold` |
| Cmd / Ctrl + I | `mark.toggle.italic` |
| Cmd / Ctrl + U | `mark.toggle.underline` |
| Cmd / Ctrl + Shift + S | `mark.toggle.strike` |
| Cmd / Ctrl + . | `mark.toggle.superscript` |
| Cmd / Ctrl + , | `mark.toggle.subscript` |

The plugin **does not register any commands**; every command above is registered by `@sobree/core` itself. So not mounting the keyboard plugin doesn't break toolbar buttons or programmatic dispatch — you can still call `editor.commands.execute("history.undo")` from anywhere.

## Customise

Pass extra bindings to the factory — they're layered on top of the defaults, last-matcher-wins:

```ts
import { keyboard } from "@sobree/keyboard";

createSobree("#editor", {
  plugins: [
    keyboard({
      bindings: [
        // Last matcher wins — this overrides Cmd+B.
        { match: (e) => (e.ctrl || e.meta) && e.key === "b", command: "my.custom.command" },
      ],
    }),
  ],
});
```

## Direct construction

For the rare case you're wiring `Editor` by hand (no `createSobree`), call `attachKeyboard` directly:

```ts
import { attachKeyboard, DEFAULT_BINDINGS } from "@sobree/keyboard";

const detach = attachKeyboard(editor, {
  bindings: [/* … */],
});
// later:
detach();
```

## License

MIT © sobree.dev
