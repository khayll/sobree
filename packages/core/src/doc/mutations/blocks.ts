// Whole-block mutations: replace / insert / delete.
//
// These compute the PLAIN (non-tracked) document patch. Track-changes
// stamping (paragraph ins/del markers) is a browser-only concern the
// `Editor` ops layer applies around these — the engine stays unaware of it.

import type { BlockRef } from "../api";
import type { Block, SobreeDocument } from "../types";
import { mergeSectionsAcross, removedSectionIndex } from "./sections";
import { type DocumentMutationResult, type MutationInput, checkRefs, okPatch } from "./types";

/** Replace the block at `target`'s index with `block`. If a section_break
 *  is replaced by a non-break, the two sections it delimited merge (the
 *  earlier section's properties survive). */
export function replaceBlockMutation(
  input: MutationInput,
  target: BlockRef,
  block: Block,
): DocumentMutationResult<BlockRef> {
  const lock = checkRefs(input.registry, [target]);
  if (lock) return lock;
  const index = input.registry.indexOf(target.id);
  const next = input.doc.body.slice();
  const wasSectionBreak = next[index]?.kind === "section_break";
  next[index] = block;
  const update: Partial<SobreeDocument> = { body: next };
  if (wasSectionBreak && block.kind !== "section_break") {
    update.sections = mergeSectionsAcross(
      input.doc.sections,
      removedSectionIndex(input.doc.body, index),
    );
  }
  return okPatch(update, [{ type: "bump", index }]);
}

/** Insert `block` before the target block. */
export function insertBlockBeforeMutation(
  input: MutationInput,
  target: BlockRef,
  block: Block,
): DocumentMutationResult<BlockRef> {
  const lock = checkRefs(input.registry, [target]);
  if (lock) return lock;
  const index = input.registry.indexOf(target.id);
  const next = input.doc.body.slice();
  next.splice(index, 0, block);
  return okPatch({ body: next }, [{ type: "insert", index }]);
}

/** Insert `block` after the target block. */
export function insertBlockAfterMutation(
  input: MutationInput,
  target: BlockRef,
  block: Block,
): DocumentMutationResult<BlockRef> {
  const lock = checkRefs(input.registry, [target]);
  if (lock) return lock;
  const index = input.registry.indexOf(target.id);
  const next = input.doc.body.slice();
  next.splice(index + 1, 0, block);
  return okPatch({ body: next }, [{ type: "insert", index: index + 1 }]);
}

/** Delete the target block. Deleting the only block leaves one empty
 *  paragraph. Deleting a section_break merges the sections it delimited. */
export function deleteBlockMutation(
  input: MutationInput,
  target: BlockRef,
): DocumentMutationResult<void> {
  const lock = checkRefs(input.registry, [target]);
  if (lock) return lock;
  const index = input.registry.indexOf(target.id);
  const wasSectionBreak = input.doc.body[index]?.kind === "section_break";
  const next = input.doc.body.slice();
  next.splice(index, 1);
  if (next.length === 0) next.push({ kind: "paragraph", properties: {}, runs: [] });
  const update: Partial<SobreeDocument> = { body: next };
  if (wasSectionBreak) {
    update.sections = mergeSectionsAcross(
      input.doc.sections,
      removedSectionIndex(input.doc.body, index),
    );
  }
  return okPatch(update, [{ type: "remove", index }]);
}
