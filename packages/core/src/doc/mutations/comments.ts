// Comment resolve/reopen — flips `Comment.done` on the document's comment
// map. Comments live outside the body registry, so no block version bumps;
// the patch still commits (and mirrors) so collaborators + the change event
// see it. Pure: given the document + id, returns the patch or a failure.

import { fail } from "../api";
import { type DocumentMutationResult, type MutationInput, okPatch } from "./types";

function setCommentDoneMutation(
  input: MutationInput,
  id: number,
  done: boolean,
): DocumentMutationResult<void> {
  const comments = input.doc.comments;
  const target = comments?.[id];
  if (!comments || !target) {
    return fail({ code: "invalid-state", details: `no comment with id ${id}` });
  }
  return okPatch({ comments: { ...comments, [id]: { ...target, done } } }, []);
}

/** Mark comment `id` resolved (`Comment.done = true`). */
export function resolveCommentMutation(
  input: MutationInput,
  id: number,
): DocumentMutationResult<void> {
  return setCommentDoneMutation(input, id, true);
}

/** Re-open a resolved comment `id` (`Comment.done = false`). */
export function reopenCommentMutation(
  input: MutationInput,
  id: number,
): DocumentMutationResult<void> {
  return setCommentDoneMutation(input, id, false);
}
