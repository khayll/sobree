# @sobree/block-tools

Floating toolbar + gutter indicator + zone editor for [`@sobree/core`](https://www.npmjs.com/package/@sobree/core).

→ Docs: **[docs.sobree.dev/api/block-tools](https://docs.sobree.dev/api/block-tools/)**

Opt-in plugin — install it and pass `blockTools()` to `createSobree({ plugins: [...] })`. It's a sibling package (rather than baked into core) so headless / Worker / agent consumers don't pay for the toolbar code.

## Install

```sh
pnpm add @sobree/core @sobree/block-tools
```

`@sobree/core` is a peer dependency.

## Mount via `createSobree`

```ts
import { createSobree } from "@sobree/core";
import { blockTools } from "@sobree/block-tools";

createSobree("#editor", {
  plugins: [blockTools()],
});
```

## Direct construction

For the rare case you're wiring `Sobree` + `Viewport` by hand, the `BlockTools` class still ships standalone:

```ts
import { Sobree, Viewport } from "@sobree/core";
import { BlockTools } from "@sobree/block-tools";

const viewport = new Viewport(host);
const sobree   = new Sobree(viewport.slot);
const tools    = new BlockTools({
  stackRoot: sobree.stackRoot,
  editor: sobree.editor,
  renderingArea: host,
  viewport,
  getSetup: () => sobree.getPageSetup(),
  setSetup: (next) => sobree.setPageSetup(next),
});
```

## What it provides

- **Gutter indicator** pinned to the active paper's left edge.
- **Floating toolbar** above the active block — text marks, alignment, lists, table ops, change-block popover.
- **Header / footer zone editing** triggered from the indicator.

## License

MIT.
