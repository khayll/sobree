import type { EditResult } from "../../doc/api";
import { reopenCommentMutation, resolveCommentMutation } from "../../doc/mutations";
import type { EditorContext } from "../context";
import { applyMutation, mutationInput } from "../internal/applyMutation";

/**
 * Browser adapters for comment resolve/reopen. The pure patch (flip
 * `Comment.done`, no block bumps) lives in `doc/mutations/comments`; these
 * sync the DOM and apply it through `ctx.commit` so the change mirrors to
 * the Y.Doc and fires the change event.
 */

/** Mark comment `id` resolved (`Comment.done = true`). */
export function resolveComment(ctx: EditorContext, id: number): EditResult<void> {
  ctx.ensureCurrent();
  return applyMutation(ctx, resolveCommentMutation(mutationInput(ctx), id));
}

/** Re-open a resolved comment `id` (`Comment.done = false`). */
export function reopenComment(ctx: EditorContext, id: number): EditResult<void> {
  ctx.ensureCurrent();
  return applyMutation(ctx, reopenCommentMutation(mutationInput(ctx), id));
}
