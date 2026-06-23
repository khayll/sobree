/**
 * Core contract for the pure document mutation engine.
 *
 * A mutation function takes a {@link MutationInput} (the current document
 * plus a read-only view of the block registry) and returns a
 * {@link DocumentMutationResult}: either a failure (lock conflict /
 * invalid state) or a {@link MutationPatch} describing the document update
 * and the registry-level {@link Mutation}s an adapter must apply. The
 * engine never commits, mirrors to Y.Doc, renders, or touches the DOM —
 * the calling adapter (`Editor` / `HeadlessSobree`) owns all of that.
 */

import { type BlockRef, type EditResult, lockConflict, ok } from "../api";
import type { SobreeDocument } from "../types";

/**
 * One registry-level operation produced by a mutation. The adapter
 * applies these to its BlockRegistry after committing the new doc:
 * `insert` adds an id, `remove` drops one, `bump` keeps the same id
 * but increments its version.
 */
export type Mutation =
  | { type: "bump"; index: number }
  | { type: "insert"; index: number }
  | { type: "remove"; index: number };

/**
 * The read-only slice of a block registry the engine depends on. Both
 * the browser `Editor`'s registry and `HeadlessSobree`'s satisfy this
 * directly — the engine stays unaware of how ids/versions are stored or
 * mutated.
 */
export interface BlockRegistryView {
  indexOf(id: string): number;
  refAt(index: number): BlockRef;
  refById(id: string): BlockRef | null;
  documentVersion(): number;
}

export interface MutationInput {
  doc: SobreeDocument;
  registry: BlockRegistryView;
}

/**
 * The result of a successful mutation: the document fields to merge, the
 * registry mutations to apply, and the value the public method returns
 * (e.g. the new `BlockRef` for an insert). The adapter's `commit` applies
 * `update` + `mutations` and surfaces `value`.
 */
export interface MutationPatch<T = void> {
  update: Partial<SobreeDocument>;
  mutations: readonly Mutation[];
  value: T;
}

export type DocumentMutationResult<T = void> = EditResult<MutationPatch<T>>;

/** Wrap a computed patch in a successful {@link DocumentMutationResult}.
 *  Affected refs are left empty — the adapter's `commit` computes them when
 *  it applies the registry mutations. */
export function okPatch<T = void>(
  update: Partial<SobreeDocument>,
  mutations: readonly Mutation[],
  value?: T,
): DocumentMutationResult<T> {
  return ok<MutationPatch<T>>({ update, mutations, value: value as T });
}

/**
 * Optimistic-lock check shared by both adapters. Aggregates every stale
 * or missing ref into a single lock conflict: a ref whose id no longer
 * exists is reported with `actual: null`; a version mismatch with the
 * live version. Returns `null` when every ref is current.
 */
export function checkRefs(
  registry: BlockRegistryView,
  refs: readonly BlockRef[],
): EditResult<never> | null {
  const conflicts: Array<{ blockId: string; expected: number; actual: number | null }> = [];
  for (const ref of refs) {
    const live = registry.refById(ref.id);
    if (!live) {
      conflicts.push({ blockId: ref.id, expected: ref.version, actual: null });
      continue;
    }
    if (live.version !== ref.version) {
      conflicts.push({ blockId: ref.id, expected: ref.version, actual: live.version });
    }
  }
  return conflicts.length > 0 ? lockConflict(conflicts) : null;
}
