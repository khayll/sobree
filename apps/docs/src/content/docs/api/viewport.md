---
title: Viewport
description: Zoom / pan stage for embedded Sobree.
---

`Viewport` is a framework-free zoomable / pannable stage. You wrap your
host element with it; Sobree mounts inside `viewport.slot`.

:::tip
[`createSobree()`](/api/create-sobree/) constructs the viewport for you
with sane defaults; it's exposed on the handle as `editor.viewport` so
you can call `fitTo`, `zoomTo`, etc. This page documents direct
construction for embedders who need custom zoom config, multiple
editors sharing one viewport, or other off-piste layouts.
:::

```ts
import { Viewport } from "@sobree/core";

const viewport = new Viewport(host, {
  minScale: 0.3,
  maxScale: 4,
  onScaleChange:     (s)    => /* update zoom readout */,
  onRenderTierChange: (tier) => sobree.setRenderTier(tier),
  onTransformChange: ()      => blockTools.refresh(),
});
```

## Layout

```
container       (the element you pass in; overflow:hidden)
  └ stage       (absolutely positioned, transform:translate(tx,ty) scale(s))
      └ slot    (where you mount editor content; viewport.slot)
```

## Gestures

- **Zoom** — `wheel` with `shiftKey` OR `ctrlKey` (macOS pinch emits
  `ctrlKey`). Cursor-anchored — the point under the cursor stays fixed.
- **Pan** — `wheel` without modifiers — two-finger trackpad scroll moves
  the stage. Axis-locking smooths gentle diagonal gestures.

## Methods

| method                                          | what it does                                |
|-------------------------------------------------|---------------------------------------------|
| `reset()`                                       | Pan to origin, scale to 1.                  |
| `getScale()`                                    | Current visual scale.                       |
| `getRenderTier()`                               | CSS-`zoom` layout tier (integer ≥ 1).       |
| `fitTo(target, mode, animate?)`                 | `mode = "width" \| "contain"`.              |
| `zoomTo(scale, anchorX, anchorY)`               | Zoom to a specific scale around a point.    |
| `panBy(dx, dy, opts?)`                          | Pan by CSS pixels. `opts.animate?: boolean`.|
| `destroy()`                                     | Remove listeners, restore container.        |

:::tip
[`createSobree()`](/api/create-sobree/) calls
`fitTo(firstPaper, "width", false)` once on mount (controlled by
`fitOnMount`, default `"width"`). If you instantiate `Viewport`
yourself, you'll usually want to do the same thing once after the
initial `paginate` event — at 1:1 an A4 paper looks tiny in a typical
host.
:::

## Two-tier rendering

Sobree pages render at a CSS-`zoom`-amplified layout tier so text
rasterises at the zoomed resolution rather than as a blitted bitmap.
`onRenderTierChange` fires at integer-scale boundaries; pass it to
`Sobree.setRenderTier` so the paper stack repaginates at the new tier.
