/**
 * Numbering / list-definition edit operations, grouped under
 * `editor.numbering` (mirrors `editor.styles`). Define, update, and remove
 * the `NumberingDefinition`s in `SobreeDocument.numbering` — the list
 * formats paragraphs reference via `properties.numbering.numId`.
 *
 * Pointing a paragraph at a list is `applyBlockProperties(refs, {
 * numbering: { numId, level } })`; this manages the definitions those ids
 * resolve to. Changes route through `ctx.commit` (re-render + Y.Doc mirror
 * + undo). Build a definition with the `numberingDefinition` /
 * `bulletDefinition` / `orderedDefinition` builders.
 */

import type { EditResult } from "../doc/api";
import {
  defineNumberingMutation,
  removeNumberingMutation,
  updateNumberingMutation,
} from "../doc/mutations";
import type { NumberingDefinition, NumberingLevel } from "../doc/types";
import type { EditorContext } from "./context";
import { applyMutation, mutationInput } from "./internal/applyMutation";

export class EditorNumbering {
  constructor(private readonly ctx: EditorContext) {}

  /** Add a new numbering definition. Fails if `def.numId` already exists. */
  define(def: NumberingDefinition): EditResult<void> {
    this.ctx.ensureCurrent();
    return applyMutation(this.ctx, defineNumberingMutation(mutationInput(this.ctx), def));
  }

  /** Replace the levels of the definition with `numId`. Fails if missing. */
  update(numId: number, levels: NumberingLevel[]): EditResult<void> {
    this.ctx.ensureCurrent();
    return applyMutation(this.ctx, updateNumberingMutation(mutationInput(this.ctx), numId, levels));
  }

  /** Remove the definition with `numId`. Fails if missing. Paragraphs that
   *  still reference it render without a marker. */
  remove(numId: number): EditResult<void> {
    this.ctx.ensureCurrent();
    return applyMutation(this.ctx, removeNumberingMutation(mutationInput(this.ctx), numId));
  }
}
