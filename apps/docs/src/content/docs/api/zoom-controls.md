---
title: ZoomControls
description: Floating zoom dock (zoom in/out, fit width, fit page) for embedded Sobree.
---

`ZoomControls` is a UI plugin that surfaces the four most-used
[`Viewport`](/api/viewport/) actions as a floating button dock pinned to
a corner of the container: **Fit page**, **Fit width**, **Zoom out**,
**Zoom in**.

## Install

```sh
pnpm add @sobree/core @sobree/zoom-controls
```

`@sobree/core` is a peer dependency. `createSobree()` doesn't auto-mount
any stock plugin — install the ones you want and pass their factories
in `plugins: []`.

## Mount via `createSobree`

```ts
import { createSobree } from "@sobree/core";
import { zoomControls } from "@sobree/zoom-controls";

createSobree("#editor", {
  plugins: [zoomControls()],
});

// With overrides:
createSobree("#editor", {
  plugins: [
    zoomControls({
      placement: "top-right",
      fitPageTarget: () => paperAtViewportCenter(),
    }),
  ],
});
```

The factory wires `container` and `viewport` from the plugin context
automatically; `fitWidthTarget` and `fitPageTarget` default to
`sobree.firstPaper`. The user-overridable subset is
`ZoomControlsPluginOptions`.

## Direct construction (without `createSobree`)

For embedders who instantiate `Sobree` themselves:

```ts
import { Sobree, Viewport } from "@sobree/core";
import { ZoomControls } from "@sobree/zoom-controls";

const host = document.querySelector<HTMLElement>("#editor")!;
const viewport = new Viewport(host);
const sobree = new Sobree(viewport.slot);

new ZoomControls({
  container: host,
  viewport,
  fitWidthTarget: () => sobree.firstPaper,
  fitPageTarget: () => sobree.firstPaper,
  placement: "bottom-right", // default
});
```

## Options

| option            | type                                                                | default          | what it does                                                       |
| ----------------- | ------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `container`       | `HTMLElement`                                                       | —                | Element the dock is pinned to (positioned `absolute` inside it).   |
| `viewport`        | `Viewport`                                                          | —                | Viewport whose scale + fit are driven by the dock.                 |
| `fitWidthTarget`  | `HTMLElement \| (() => HTMLElement)`                                | —                | Element fitted when **Fit width** is pressed. Function = dynamic.  |
| `fitPageTarget`   | `HTMLElement \| (() => HTMLElement)`                                | —                | Element fitted when **Fit page** is pressed.                       |
| `zoomFactor`      | `number`                                                            | `1.2`            | Multiplicative step per zoom-in / zoom-out click.                  |
| `animateFit`      | `boolean`                                                           | `true`           | Animate the pan when fit-width / fit-page is pressed.              |
| `placement`       | `"bottom-right" \| "bottom-left" \| "top-right" \| "top-left"`      | `"bottom-right"` | Corner of the container the dock is pinned to.                     |

## Placement

The dock is positioned `absolute` inside `container`. The chosen
`placement` is reflected as a `data-placement` attribute on the root
element (`.sobree-zoom-controls`), so consumers can override or theme
specific corners from CSS:

```css
.sobree-zoom-controls[data-placement="top-right"] {
  /* tweak just the top-right variant */
  top: 24px;
  right: 24px;
}
```

## Methods

| method        | what it does                                  |
| ------------- | --------------------------------------------- |
| `destroy()`   | Remove listeners, detach the dock element.    |

## Picking a fit target

`fitWidthTarget` typically points at `editor.sobree.firstPaper` — the
first paper of the document, which has the canonical content width.

`fitPageTarget` is more interesting. A common pattern is to fit
whichever page the user is currently looking at (the paper closest to
the viewport's vertical centre):

```ts
function paperAtViewportCenter(): HTMLElement {
  const vp = host.getBoundingClientRect();
  const cy = vp.top + vp.height / 2;
  const papers = Array.from(
    editor.sobree.stackRoot.querySelectorAll(".paper"),
  ) as HTMLElement[];
  if (papers.length === 0) return editor.sobree.firstPaper;
  let best = papers[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const p of papers) {
    const r = p.getBoundingClientRect();
    if (cy >= r.top && cy <= r.bottom) return p;
    const d = Math.min(Math.abs(r.top - cy), Math.abs(r.bottom - cy));
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best ?? editor.sobree.firstPaper;
}

new ZoomControls({
  container: host,
  viewport: editor.viewport,
  fitWidthTarget: () => editor.sobree.firstPaper,
  fitPageTarget: paperAtViewportCenter,
});
```

## Replacing it

`ZoomControls` is one possible UI. Skip it and call the underlying
[`Viewport`](/api/viewport/) API yourself — `viewport.zoomTo()`,
`viewport.fitTo()`, `viewport.getScale()` — wired into your own buttons,
keyboard shortcuts, or a percentage readout.
