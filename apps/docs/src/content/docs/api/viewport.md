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

Options are `ViewportOptions` — all optional:

```ts
import { Viewport } from "@sobree/core";

const viewport = new Viewport(host, {
  minScale: 0.3,
  maxScale: 4,
  onScaleChange:     (s) => /* update zoom readout */,
  onTransformChange: ()  => blockTools.refresh(),
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
- **Touch (mobile)** — one-finger drag pans, with a small slop radius so
  taps still place the caret and press buttons; two-finger pinch zooms
  anchored at the finger midpoint, and translating both fingers pans.
  Mouse / pen drag is left alone — that's text selection. The synthetic
  click browsers fire after a drag is swallowed so panning never
  teleports the caret.

## Methods

| method                                          | what it does                                |
|-------------------------------------------------|---------------------------------------------|
| `reset()`                                       | Pan to origin, scale to 1.                  |
| `getScale()`                                    | Current visual scale.                       |
| `getRenderTier()`                               | Always `1` — retained for compatibility (see below). |
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

## Zoom never changes layout

Zoom is a pure `transform: scale` — the document is laid out exactly
once, and line breaks and page breaks are identical at every zoom
level. Sharpness comes from two-phase rendering instead of re-layout:

- **While a gesture is live**, the stage stays on a compositor layer and
  frames just stretch the cached texture — momentarily soft, but 60 fps.
- **~0.2 s after input stops**, the viewport drops the layer pin and the
  compositor re-rasterises at the effective scale — text at 4× is as
  sharp as a natively-sized layout.

This needs no wiring; it's internal to `Viewport`.

### Retired: layout-side render tiers

Earlier versions re-laid-out the page at quantised CSS `zoom` tiers for
sharp text. Browsers scale font metrics and the page's mm-derived width
through different rounding paths, so text rewrapped and pagination
shifted at tier boundaries — zoom visibly changed layout. The tier API
is retained for compatibility but inert: `getRenderTier()` always
returns `1`, and `onRenderTierChange` never fires. Don't wire it in new
code.
