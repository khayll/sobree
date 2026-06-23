import type { BlockRef, EditResult } from "../../doc/api";
import {
  applyBlockPropertiesMutation,
  deleteBlockMutation,
  insertBlockAfterMutation,
  insertBlockBeforeMutation,
  replaceBlockMutation,
} from "../../doc/mutations";
import type { Block, RevisionMark } from "../../doc/types";
import type { EditorContext } from "../context";
import { applyMutation, mutationInput } from "../internal/applyMutation";
import type { ParagraphPropertiesPatch } from "../types";

/**
 * Block-level mutations: replace / insert / delete whole blocks and
 * patch paragraph properties. The plain document transform lives in the
 * shared `doc/mutations` engine (lock check + body splice + section-break
 * merge); these wrappers add the browser-only track-changes behaviour and
 * apply the engine's patch through `ctx.commit`. Track-changes mode stamps
 * paragraph insert/delete markers instead of moving content outright.
 */

/** Replace the block at `target`'s index with `block`. */
export function replaceBlock(
  ctx: EditorContext,
  target: BlockRef,
  block: Block,
): EditResult<BlockRef> {
  ctx.ensureCurrent();
  return applyMutation(ctx, replaceBlockMutation(mutationInput(ctx), target, block));
}

/**
 * Insert `block` before the target block. Returns the new ref.
 *
 * In track-changes mode, if `block` is a paragraph it gets stamped with
 * `revision: { type: "ins", author }` on its properties — the same
 * paragraph-mark semantics as `splitBlock`. Non-paragraph blocks (table,
 * section_break) don't carry the marker in v1 and insert plain.
 */
export function insertBlockBefore(
  ctx: EditorContext,
  target: BlockRef,
  block: Block,
): EditResult<BlockRef> {
  ctx.ensureCurrent();
  const stamped = stampInsertedBlockIfTracked(ctx, block);
  return applyMutation(ctx, insertBlockBeforeMutation(mutationInput(ctx), target, stamped));
}

/**
 * Insert `block` after the target block. Returns the new ref.
 * Tracked-mode behaviour matches `insertBlockBefore`.
 */
export function insertBlockAfter(
  ctx: EditorContext,
  target: BlockRef,
  block: Block,
): EditResult<BlockRef> {
  ctx.ensureCurrent();
  const stamped = stampInsertedBlockIfTracked(ctx, block);
  return applyMutation(ctx, insertBlockAfterMutation(mutationInput(ctx), target, stamped));
}

/**
 * Delete the target block.
 *
 * In track-changes mode, paragraph blocks aren't removed — their
 * `properties.revision` is stamped `del` (the renderer shows the
 * paragraph mark with a strikethrough ¶ glyph; the body text stays
 * visible). If the paragraph carries the *current author's* pending
 * `ins` marker (a paragraph the user themselves just created), the block
 * is removed outright — cancelling an un-committed insert, matching the
 * inline `deleteRange` semantics. Non-paragraph blocks (tables, section
 * breaks) bypass tracking in v1 — they remove plainly via the engine.
 */
export function deleteBlock(ctx: EditorContext, target: BlockRef): EditResult<void> {
  ctx.ensureCurrent();
  if (ctx.trackChanges.enabled) {
    const lockCheck = ctx.checkRefs([target]);
    if (lockCheck) return lockCheck;
    const index = ctx.registry.indexOf(target.id);
    const current = ctx.doc.body[index];
    // Stamp a tracked deletion, UNLESS this is the author cancelling their
    // own pending insert — then fall through to the engine's plain remove.
    if (current?.kind === "paragraph") {
      const existing = current.properties.revision;
      const cancellingOwnInsert =
        existing?.type === "ins" && existing.author === ctx.trackChanges.author;
      if (!cancellingOwnInsert) {
        const revision: RevisionMark =
          ctx.trackChanges.author === undefined
            ? { type: "del" }
            : { type: "del", author: ctx.trackChanges.author };
        const next = ctx.doc.body.slice();
        next[index] = {
          ...current,
          properties: { ...current.properties, revision },
        };
        return ctx.commit({ body: next }, [{ type: "bump", index }]);
      }
    }
  }
  return applyMutation(ctx, deleteBlockMutation(mutationInput(ctx), target));
}

/**
 * Stamp `revision: ins` on a paragraph block if tracked mode is on and
 * the block doesn't already carry one. Helper for `insertBlockBefore` /
 * `insertBlockAfter`. Non-paragraph blocks pass through unchanged.
 */
function stampInsertedBlockIfTracked(ctx: EditorContext, block: Block): Block {
  if (!ctx.trackChanges.enabled) return block;
  if (block.kind !== "paragraph") return block;
  if (block.properties.revision) return block;
  const revision: RevisionMark =
    ctx.trackChanges.author === undefined
      ? { type: "ins" }
      : { type: "ins", author: ctx.trackChanges.author };
  return { ...block, properties: { ...block.properties, revision } };
}

/** Merge a patch into each target paragraph's properties. */
export function applyBlockProperties(
  ctx: EditorContext,
  targets: BlockRef[],
  patch: ParagraphPropertiesPatch,
): EditResult<void> {
  ctx.ensureCurrent();
  return applyMutation(ctx, applyBlockPropertiesMutation(mutationInput(ctx), targets, patch));
}
