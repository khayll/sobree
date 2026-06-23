/**
 * Named-style edit operations, grouped under `editor.styles` (mirrors
 * `editor.table` / `editor.sections`). Define, update, and remove the
 * `NamedStyle` definitions in `SobreeDocument.styles` — the cascade a
 * paragraph / run / table resolves through when it references a `styleId`.
 *
 * Applying a `styleId` to content is `applyBlockProperties` /
 * `applyRunProperties`; this is the complementary surface for the style
 * DEFINITIONS themselves. Changes route through `ctx.commit` (full
 * re-render — a style edit ripples through the cascade — + Y.Doc mirror +
 * undo). Use the `namedStyle()` builder to construct a style to `define`.
 */

import type { EditResult } from "../doc/api";
import { defineStyleMutation, removeStyleMutation, updateStyleMutation } from "../doc/mutations";
import type { NamedStyle } from "../doc/types";
import type { EditorContext } from "./context";
import { applyMutation, mutationInput } from "./internal/applyMutation";
import type { NamedStylePatch } from "./types";

export class EditorStyles {
  constructor(private readonly ctx: EditorContext) {}

  /** Add a new style. Fails if a style with the same `id` already exists
   *  (use {@link update} to change one). */
  define(style: NamedStyle): EditResult<void> {
    this.ctx.ensureCurrent();
    return applyMutation(this.ctx, defineStyleMutation(mutationInput(this.ctx), style));
  }

  /** Merge a patch into the style with `id`. Fails if no such style. */
  update(id: string, patch: NamedStylePatch): EditResult<void> {
    this.ctx.ensureCurrent();
    return applyMutation(this.ctx, updateStyleMutation(mutationInput(this.ctx), id, patch));
  }

  /** Remove the style with `id`. Fails if no such style. Content that
   *  still references it falls back to the cascade's defaults. */
  remove(id: string): EditResult<void> {
    this.ctx.ensureCurrent();
    return applyMutation(this.ctx, removeStyleMutation(mutationInput(this.ctx), id));
  }
}
