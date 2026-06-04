import { type EditResult, fail } from "../../doc/api";
import type { EditorContext } from "../context";

/**
 * Comment resolve/reopen — flips `Comment.done` on the document's
 * comment map. Comments live outside the body registry, so no block
 * version bumps are needed; the change still commits (and mirrors) so
 * collaborators and the change event see it.
 */

/** Mark comment `id` resolved (`Comment.done = true`). */
export function resolveComment(ctx: EditorContext, id: number): EditResult<void> {
  return setCommentDone(ctx, id, true);
}

/** Re-open a resolved comment `id` (`Comment.done = false`). */
export function reopenComment(ctx: EditorContext, id: number): EditResult<void> {
  return setCommentDone(ctx, id, false);
}

function setCommentDone(ctx: EditorContext, id: number, done: boolean): EditResult<void> {
  ctx.ensureCurrent();
  const comments = ctx.doc.comments;
  const target = comments?.[id];
  if (!comments || !target) {
    return fail({ code: "invalid-state", details: `no comment with id ${id}` });
  }
  const nextComments = { ...comments, [id]: { ...target, done } };
  // No block bumps — comments live outside the body registry.
  return ctx.commit({ comments: nextComments }, []);
}
