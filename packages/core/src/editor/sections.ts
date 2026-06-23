/**
 * Section-level edit operations, grouped under `editor.sections` (mirrors
 * `editor.table`). Keeping them on a sub-object keeps the Editor facade
 * thin: new section ops land here, not on `index.ts`.
 *
 * A section is identified by its index in the document's `sections` array
 * — the common single-section document is index 0. Changes route through
 * the standard `ctx.commit` pipeline (full re-render + Y.Doc mirror + undo);
 * no block versions are bumped, since a section is not a block.
 */

import type { EditResult } from "../doc/api";
import { applySectionPropertiesMutation } from "../doc/mutations";
import type { EditorContext } from "./context";
import { applyMutation, mutationInput } from "./internal/applyMutation";
import type { SectionPropertiesPatch } from "./types";

export class EditorSections {
  constructor(private readonly ctx: EditorContext) {}

  /**
   * Merge a patch into the section at `index`: page size / margins,
   * columns, header/footer refs, vertical alignment. `pageSize` /
   * `pageMargins` are field-merged (a partial stays valid); other fields
   * replace wholesale, and an explicit `undefined` clears an optional one.
   * Re-renders page geometry; undo-integrated.
   */
  setProperties(index: number, patch: SectionPropertiesPatch): EditResult<void> {
    this.ctx.ensureCurrent();
    return applyMutation(
      this.ctx,
      applySectionPropertiesMutation(mutationInput(this.ctx), index, patch),
    );
  }
}
