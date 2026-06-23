/**
 * Glue between the pure mutation engine (`doc/mutations`) and the browser
 * `Editor`. The engine computes a {@link DocumentMutationResult}; the
 * `Editor` applies it through its existing `commit` pipeline (registry
 * mutations + render + Y.Doc mirror + history + change event).
 */

import type { EditResult } from "../../doc/api";
import type { DocumentMutationResult, MutationInput } from "../../doc/mutations";
import type { EditorContext } from "../context";

/** Build the engine input from the live editor context. The `BlockRegistry`
 *  satisfies `BlockRegistryView` directly. */
export function mutationInput(ctx: EditorContext): MutationInput {
  return { doc: ctx.doc, registry: ctx.registry };
}

/** Apply a mutation result through `ctx.commit`, or pass the failure
 *  through unchanged. */
export function applyMutation<T>(
  ctx: EditorContext,
  result: DocumentMutationResult<T>,
): EditResult<T> {
  if (!result.ok) return result;
  const { update, mutations, value } = result.value;
  return ctx.commit(update, mutations, value);
}
