// Numbering / list-definition CRUD mutations.

import { fail } from "../api";
import type { NumberingDefinition, NumberingLevel } from "../types";
import { type DocumentMutationResult, type MutationInput, okPatch } from "./types";

/** Add a new numbering definition. Fails if `def.numId` already exists. */
export function defineNumberingMutation(
  input: MutationInput,
  def: NumberingDefinition,
): DocumentMutationResult<void> {
  if (input.doc.numbering.some((n) => n.numId === def.numId)) {
    return fail({ code: "invalid-state", details: `numbering ${def.numId} already exists` });
  }
  return okPatch({ numbering: [...input.doc.numbering, def] }, []);
}

/** Replace the levels of the definition with `numId`. Fails if missing. */
export function updateNumberingMutation(
  input: MutationInput,
  numId: number,
  levels: NumberingLevel[],
): DocumentMutationResult<void> {
  const numbering = input.doc.numbering;
  const index = numbering.findIndex((n) => n.numId === numId);
  if (index < 0) return fail({ code: "invalid-state", details: `no numbering ${numId}` });
  const next = numbering.slice();
  next[index] = { numId, abstractFormat: { levels } };
  return okPatch({ numbering: next }, []);
}

/** Remove the definition with `numId`. Fails if missing. */
export function removeNumberingMutation(
  input: MutationInput,
  numId: number,
): DocumentMutationResult<void> {
  if (!input.doc.numbering.some((n) => n.numId === numId)) {
    return fail({ code: "invalid-state", details: `no numbering ${numId}` });
  }
  return okPatch({ numbering: input.doc.numbering.filter((n) => n.numId !== numId) }, []);
}
