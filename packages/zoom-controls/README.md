# @sobree/zoom-controls

Floating zoom dock for [`@sobree/core`](https://www.npmjs.com/package/@sobree/core) viewports.

Four buttons pinned to a corner of the container: **Fit page**, **Fit width**, **Zoom out**, **Zoom in**. Idle at 50% opacity, fully opaque on hover/focus. Framework-free; one CSS file is auto-injected. Default corner is `bottom-right`; configurable via the `placement` option.

Opt-in plugin — install it and pass `zoomControls()` to `createSobree({ plugins: [...] })`.

## Install

```sh
pnpm add @sobree/core @sobree/zoom-controls
```

`@sobree/core` is a peer dependency.

## Mount via `createSobree`

```ts
import { createSobree } from "@sobree/core";
import { zoomControls } from "@sobree/zoom-controls";

createSobree("#editor", {
  plugins: [
    zoomControls({ placement: "bottom-right" }), // default — also: "bottom-left" | "top-right" | "top-left"
  ],
});
```

The factory pulls `viewport` / `host` / `firstPaper` from the plugin
context, so you only need to pass overrides (placement, zoomFactor,
animateFit, custom fit targets).

## Direct construction

For the rare case you're wiring `Sobree` + `Viewport` by hand, the `ZoomControls` class still ships standalone:

```ts
import { Sobree, Viewport } from "@sobree/core";
import { ZoomControls } from "@sobree/zoom-controls";

const viewport = new Viewport(host);
const sobree   = new Sobree(viewport.slot);

new ZoomControls({
  container: host,
  viewport,
  fitWidthTarget: () => sobree.firstPaper,
  fitPageTarget: () => sobree.firstPaper,
  placement: "bottom-right",
});
```

## Options

| Option            | Type                                        | Default          | Description                                                       |
| ----------------- | ------------------------------------------- | ---------------- | ----------------------------------------------------------------- |
| `container`       | `HTMLElement`                               | —                | Element the dock is pinned to (positioned `absolute` inside it).  |
| `viewport`        | `Viewport`                                  | —                | Viewport whose scale and fit are driven by the dock.              |
| `fitWidthTarget`  | `HTMLElement \| (() => HTMLElement)`         | —                | Element to fit when **Fit width** is pressed.                     |
| `fitPageTarget`   | `HTMLElement \| (() => HTMLElement)`         | —                | Element to fit when **Fit page** is pressed.                      |
| `zoomFactor`      | `number`                                    | `1.2`            | Multiplicative step per zoom-in / zoom-out click.                 |
| `animateFit`      | `boolean`                                   | `true`           | Animate the pan when fit-width / fit-page is pressed.             |
| `placement`       | `"bottom-right" \| "bottom-left" \| "top-right" \| "top-left"` | `"bottom-right"` | Which corner of the container the dock is pinned to. Reflected as a `data-placement` attribute on the dock root for further CSS overrides. |

## License

MIT © sobree.dev
