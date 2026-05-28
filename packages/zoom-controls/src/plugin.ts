/**
 * `SobreePlugin` factory wrapping the `ZoomControls` class. Hand the
 * result to `createSobree({ plugins: [...] })`; setup constructs the
 * dock against the plugin context (host + viewport + sobree.firstPaper)
 * and destroy tears it down.
 *
 * For embedders who skipped `createSobree()`, the `ZoomControls`
 * class itself is exported from this package — instantiate directly
 * with full `ZoomControlsOptions`.
 */

import type { SobreePlugin } from "@sobree/core";
import { ZoomControls, type ZoomControlsOptions } from "./zoomControls";

/**
 * User-overridable subset of `ZoomControlsOptions`. `container` and
 * `viewport` come from the plugin context; `fitWidthTarget` defaults
 * to `sobree.firstPaperRow` (paper card + comments sidebar, so
 * fit-to-width doesn't clip the sidebar) and `fitPageTarget` defaults
 * to `sobree.firstPaper` (the paper card alone). Both can be
 * overridden per-call.
 */
export type ZoomControlsPluginOptions = Partial<
  Omit<ZoomControlsOptions, "container" | "viewport">
>;

export function zoomControls(
  opts: ZoomControlsPluginOptions = {},
): SobreePlugin {
  return {
    name: "zoom-controls",
    setup({ host, viewport, sobree }) {
      const dock = new ZoomControls({
        container: host,
        viewport,
        fitWidthTarget: () => sobree.firstPaperRow,
        fitPageTarget: () => sobree.firstPaper,
        ...opts,
      });
      return { destroy: () => dock.destroy() };
    },
  };
}
