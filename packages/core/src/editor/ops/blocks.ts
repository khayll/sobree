import { type BlockRef, type EditResult, fail } from "../../doc/api";
import type { Block, RevisionMark, SobreeDocument } from "../../doc/types";
import type { EditorContext } from "../context";
import {
  type Mutation,
  mergeParagraphProps,
  mergeSectionsAcross,
  removedSectionIndex,
} from "../internal/mutations";
import type { ParagraphPropertiesPatch } from "../types";

/**
 * Block-level mutations: replace / insert / delete whole blocks and
 * patch paragraph properties. All enforce optimistic locking via
 * `ctx.checkRefs` and route through `ctx.commit`. Section-break removal
 * merges the two sections it delimited. Track-changes mode stamps
 * paragraph insert/delete markers instead of moving content outright.
 */

/** Replace the block at `target`'s index with `block`. */
export function replaceBlock(
  ctx: EditorContext,
  target: BlockRef,
  block: Block,
): EditResult<BlockRef> {
  ctx.ensureCurrent();
  const lockCheck = ctx.checkRefs([target]);
  if (lockCheck) return lockCheck;
  const index = ctx.registry.indexOf(target.id);
  const next = ctx.doc.body.slice();
  const wasSectionBreak = next[index]?.kind === "section_break";
  next[index] = block;
  // If a SectionBreak was the previous block here and the replacement
  // isn't one, the two sections it separated must merge — there's
  // nothing left to delimit them. The earlier section's properties survive.
  const update: Partial<SobreeDocument> = { body: next };
  if (wasSectionBreak && block.kind !== "section_break") {
    update.sections = mergeSectionsAcross(
      ctx.doc.sections,
      removedSectionIndex(ctx.doc.body, index),
    );
  }
  return ctx.commit(update, [{ type: "bump", index }]);
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
  const lockCheck = ctx.checkRefs([target]);
  if (lockCheck) return lockCheck;
  const index = ctx.registry.indexOf(target.id);
  const stamped = stampInsertedBlockIfTracked(ctx, block);
  const next = ctx.doc.body.slice();
  next.splice(index, 0, stamped);
  return ctx.commit({ body: next }, [{ type: "insert", index }]);
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
  const lockCheck = ctx.checkRefs([target]);
  if (lockCheck) return lockCheck;
  const index = ctx.registry.indexOf(target.id);
  const stamped = stampInsertedBlockIfTracked(ctx, block);
  const next = ctx.doc.body.slice();
  next.splice(index + 1, 0, stamped);
  return ctx.commit({ body: next }, [{ type: "insert", index: index + 1 }]);
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
 * breaks) bypass tracking in v1 — they remove plainly.
 */
export function deleteBlock(ctx: EditorContext, target: BlockRef): EditResult<void> {
  ctx.ensureCurrent();
  const lockCheck = ctx.checkRefs([target]);
  if (lockCheck) return lockCheck;
  const index = ctx.registry.indexOf(target.id);
  const current = ctx.doc.body[index];

  if (ctx.trackChanges.enabled && current?.kind === "paragraph") {
    const existing = current.properties.revision;
    // Cancelling own pending ins → actually remove.
    if (existing?.type === "ins" && existing.author === ctx.trackChanges.author) {
      // fall through to plain remove below
    } else {
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

  const wasSectionBreak = current?.kind === "section_break";
  const next = ctx.doc.body.slice();
  next.splice(index, 1);
  if (next.length === 0) next.push({ kind: "paragraph", properties: {}, runs: [] });
  const update: Partial<SobreeDocument> = { body: next };
  if (wasSectionBreak) {
    update.sections = mergeSectionsAcross(
      ctx.doc.sections,
      removedSectionIndex(ctx.doc.body, index),
    );
  }
  return ctx.commit(update, [{ type: "remove", index }]);
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
  const lockCheck = ctx.checkRefs(targets);
  if (lockCheck) return lockCheck;
  const next = ctx.doc.body.slice();
  const bumps: Mutation[] = [];
  for (const ref of targets) {
    const index = ctx.registry.indexOf(ref.id);
    const block = next[index];
    if (!block) continue;
    if (block.kind !== "paragraph") {
      return fail({
        code: "invalid-state",
        details: `block ${ref.id} is not a paragraph`,
      });
    }
    next[index] = { ...block, properties: mergeParagraphProps(block.properties, patch) };
    bumps.push({ type: "bump", index });
  }
  return ctx.commit({ body: next }, bumps);
}
