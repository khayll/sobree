---
title: BlockTools
description: The default floating-toolbar UI plugin.
---

`BlockTools` mounts the gutter indicator + floating block toolbar.
It's a UI plugin — it needs context the editor doesn't have (the
rendering area, the viewport for animated panning).

## Install

```sh
pnpm add @sobree/core @sobree/block-tools
```

`@sobree/core` is a peer dependency. `createSobree()` doesn't auto-mount
any stock plugin — install the ones you want and pass their factories
in `plugins: []`.

## Mount via `createSobree`

```ts
import { createSobree } from "@sobree/core";
import { blockTools } from "@sobree/block-tools";

createSobree("#editor", {
  plugins: [blockTools()],
});
```

The factory wires `BlockTools` against the plugin context (host,
viewport, sobree, editor) automatically — the user-overridable subset
of `BlockToolsOptions` is `BlockToolsPluginOptions`.

## Direct construction (without `createSobree`)

For embedders who instantiate `Sobree` themselves:

```ts
import { Sobree } from "@sobree/core";
import { BlockTools } from "@sobree/block-tools";

const sobree = new Sobree(host);
new BlockTools({
  stackRoot: sobree.stackRoot,
  editor: sobree.editor,
  renderingArea: host,                       // the scrollable viewport element
  viewport,                                  // for animated pans (Case-C positioning)
  getSetup: () => sobree.getPageSetup(),
  setSetup: (next) => sobree.setPageSetup(next),
});
```

## What it provides

- **Gutter indicator.** Single floating chip pinned to the left edge of
  the active paper, follows hover + selection. Click to open the toolbar.
  Esc toggles when visible.
- **Floating toolbar.** Opens above the active block. Three positioning
  rules: stick-to-top for tall blocks, 8 px above for small ones, animated
  viewport pan when the toolbar would clip outside the rendering area.
- **Per-kind tools.** Text marks (B/I/U/S/sup/sub), alignment, lists,
  table ops (Cell / Table mode pill), heading-level select, image alt.
- **Change-block popover.** Convert paragraph ↔ heading / quote / list,
  insert section break.
- **Header / footer zone editing.** Click the indicator on a header /
  footer zone → in-place editable.

## Methods

| method                  | what it does                                         |
|-------------------------|------------------------------------------------------|
| `refresh()`             | Recompute indicator + toolbar position.              |
| `setSuspended(value)`   | Hide indicator + close toolbar (e.g. read mode).     |
| `destroy()`             | Tear down listeners, remove elements.                |

The embedder calls `refresh()` after layout changes:

```ts
sobree.on("paginate", () => blockTools.refresh());
sobree.on("setup",    () => blockTools.refresh());
viewport.options.onTransformChange = () => blockTools.refresh();
```

## Replacing it

`BlockTools` is one possible UI. Skip it and bring your own:

```ts
// Just don't include `blockTools()` in your `plugins` array:
const editor = createSobree("#editor", {
  plugins: [keyboard()],   // your own toolbar takes care of the rest
});
// ...register your own commands or read editor.commands.list() to render
//    your toolbar of choice.
```

The same `editor.commands.execute("mark.toggle.bold")` dispatch path drives
both — your toolbar and the default `BlockTools` would share commands if
you ran them side by side.
