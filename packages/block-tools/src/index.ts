/**
 * Public surface of `@sobree/block-tools` — a pure barrel.
 *
 * The orchestrator class lives in `./blockTools` and the plugin factory in
 * `./plugin`; this file only re-exports them. Keeping the entry point free
 * of definitions is what lets `plugin.ts` import the `BlockTools` class from
 * its defining module rather than back through the barrel — without that
 * separation the two modules form an import cycle (`index → plugin → index`).
 */

export { BlockTools } from "./blockTools";
export type { BlockToolsOptions } from "./blockTools";

// Plugin factory — recommended for createSobree() embedders.
export { blockTools } from "./plugin";
export type { BlockToolsPluginOptions } from "./plugin";
