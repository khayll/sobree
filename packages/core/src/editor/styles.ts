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

import { type EditResult, fail } from "../doc/api";
import type { NamedStyle } from "../doc/types";
import type { EditorContext } from "./context";
import { mergeNamedStyle } from "./internal/mutations";
import type { NamedStylePatch } from "./types";

export class EditorStyles {
  constructor(private readonly ctx: EditorContext) {}

  /** Add a new style. Fails if a style with the same `id` already exists
   *  (use {@link update} to change one). */
  define(style: NamedStyle): EditResult<void> {
    this.ctx.ensureCurrent();
    const styles = this.ctx.doc.styles;
    if (styles.some((s) => s.id === style.id)) {
      return fail({ code: "invalid-state", details: `style "${style.id}" already exists` });
    }
    return this.ctx.commit({ styles: [...styles, style] }, []);
  }

  /** Merge a patch into the style with `id`. Fails if no such style. */
  update(id: string, patch: NamedStylePatch): EditResult<void> {
    this.ctx.ensureCurrent();
    const styles = this.ctx.doc.styles;
    const index = styles.findIndex((s) => s.id === id);
    if (index < 0) return fail({ code: "invalid-state", details: `no style "${id}"` });
    const next = styles.slice();
    // biome-ignore lint/style/noNonNullAssertion: index came from findIndex.
    next[index] = mergeNamedStyle(styles[index]!, patch);
    return this.ctx.commit({ styles: next }, []);
  }

  /** Remove the style with `id`. Fails if no such style. Content that
   *  still references it falls back to the cascade's defaults. */
  remove(id: string): EditResult<void> {
    this.ctx.ensureCurrent();
    const styles = this.ctx.doc.styles;
    if (!styles.some((s) => s.id === id)) {
      return fail({ code: "invalid-state", details: `no style "${id}"` });
    }
    return this.ctx.commit({ styles: styles.filter((s) => s.id !== id) }, []);
  }
}
