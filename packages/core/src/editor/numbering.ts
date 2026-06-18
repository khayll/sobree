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

import { type EditResult, fail } from "../doc/api";
import type { NumberingDefinition, NumberingLevel } from "../doc/types";
import type { EditorContext } from "./context";

export class EditorNumbering {
  constructor(private readonly ctx: EditorContext) {}

  /** Add a new numbering definition. Fails if `def.numId` already exists. */
  define(def: NumberingDefinition): EditResult<void> {
    this.ctx.ensureCurrent();
    const numbering = this.ctx.doc.numbering;
    if (numbering.some((n) => n.numId === def.numId)) {
      return fail({ code: "invalid-state", details: `numbering ${def.numId} already exists` });
    }
    return this.ctx.commit({ numbering: [...numbering, def] }, []);
  }

  /** Replace the levels of the definition with `numId`. Fails if missing. */
  update(numId: number, levels: NumberingLevel[]): EditResult<void> {
    this.ctx.ensureCurrent();
    const numbering = this.ctx.doc.numbering;
    const index = numbering.findIndex((n) => n.numId === numId);
    if (index < 0) return fail({ code: "invalid-state", details: `no numbering ${numId}` });
    const next = numbering.slice();
    next[index] = { numId, abstractFormat: { levels } };
    return this.ctx.commit({ numbering: next }, []);
  }

  /** Remove the definition with `numId`. Fails if missing. Paragraphs that
   *  still reference it render without a marker. */
  remove(numId: number): EditResult<void> {
    this.ctx.ensureCurrent();
    const numbering = this.ctx.doc.numbering;
    if (!numbering.some((n) => n.numId === numId)) {
      return fail({ code: "invalid-state", details: `no numbering ${numId}` });
    }
    return this.ctx.commit({ numbering: numbering.filter((n) => n.numId !== numId) }, []);
  }
}
