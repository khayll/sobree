/**
 * Plugin contract for `createSobree()`.
 *
 * A plugin is an object with a `setup` function that receives the
 * editor surface (editor, sobree façade, viewport, host) and returns
 * a teardown function. `createSobree()` invokes `setup` once per
 * plugin during mount, in array order; on `editor.destroy()` it runs
 * the destroyers in reverse (LIFO).
 *
 * Plugins are **opaque** after handoff — once passed to
 * `createSobree`, the user doesn't reach back in. Stock plugins
 * (keyboard / block-tools / zoom-controls) self-manage
 * every internal listener through `editor.on(...)` / `sobree.on(...)`,
 * so no instance access is needed. A plugin author who DOES need to
 * expose external methods (e.g. an autosave plugin's `flush()`) can
 * return a richer object that's still a valid `SobreePlugin`.
 */

import type { Editor } from "./editor";
import type { Viewport } from "./embed/viewport";
import type { Sobree } from "./sobree";

export interface PluginContext {
  /** The framework-free editor kernel. */
  editor: Editor;
  /** The Sobree façade — paper stack, page setup, mode, headers/footers. */
  sobree: Sobree;
  /** The viewport — pannable / zoomable stage. */
  viewport: Viewport;
  /** The element `createSobree()` was mounted into. */
  host: HTMLElement;
}

export interface SobreePluginInstance {
  /** Tear down everything `setup` allocated. Called on createSobree's
   *  destroy, in reverse-of-setup order. */
  destroy(): void;
}

export interface SobreePlugin {
  /** Diagnostic name surfaced in setup-failure logs. Optional. */
  name?: string;
  /** Mount the plugin against the editor surface. Returns a destroyer. */
  setup(ctx: PluginContext): SobreePluginInstance;
}
