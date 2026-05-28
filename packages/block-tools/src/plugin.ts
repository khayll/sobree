/**
 * `SobreePlugin` factory wrapping the `BlockTools` class. Hand the
 * result to `createSobree({ plugins: [...] })`; setup constructs a
 * `BlockTools` against the plugin context and destroy tears it down.
 *
 * For embedders who skipped `createSobree()`, the `BlockTools` class
 * itself is exported from this package — instantiate directly with
 * full `BlockToolsOptions`.
 */

import type { SobreePlugin } from "@sobree/core";
import { BlockTools, type BlockToolsOptions } from "./index";

/**
 * User-overridable subset of `BlockToolsOptions`. The non-overridable
 * fields (`stackRoot`, `editor`, `renderingArea`, `viewport`,
 * `getSetup`, `setSetup`) come from the plugin context — the user
 * can't sensibly override them.
 */
export type BlockToolsPluginOptions = Partial<
  Omit<
    BlockToolsOptions,
    | "stackRoot"
    | "editor"
    | "renderingArea"
    | "viewport"
    | "getSetup"
    | "setSetup"
    | "getSectionCount"
    | "getSectionSetup"
    | "setSectionSetup"
  >
>;

export function blockTools(opts: BlockToolsPluginOptions = {}): SobreePlugin {
  return {
    name: "block-tools",
    setup({ editor, sobree, viewport, host }) {
      const tools = new BlockTools({
        stackRoot: sobree.stackRoot,
        editor,
        renderingArea: host,
        viewport,
        getSetup: () => sobree.getPageSetup(),
        setSetup: (next) => sobree.setPageSetup(next),
        // Section-aware page setup — feeds the popover's section picker
        // and applies edits to the section the caret lives in.
        getSectionCount: () => sobree.getSectionCount(),
        getSectionSetup: (index) => sobree.getSectionSetup(index),
        setSectionSetup: (index, partial) => sobree.setSectionSetup(index, partial),
        ...opts,
      });
      return { destroy: () => tools.destroy() };
    },
  };
}
