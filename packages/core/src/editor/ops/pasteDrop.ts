/**
 * External HTML / text DROP → model-first insert (Phase 3-7). A thin DragEvent
 * adapter: map the drop point to a model caret, then hand off to the paste
 * insertion pipeline. Image drops and internal drag-MOVE (delete-then-insert)
 * are handled elsewhere.
 */

import type { Range as ApiRange, InlinePosition } from "../../doc/api";
import type { EditorContext } from "../context";
import { caretRangeFromPoint, hasImageInDataTransfer } from "../dom";
import { positionFromDomPoint } from "../internal/positionMap";
import { pasteHtmlAtCaret } from "./pasteInsert";
import { deleteRange } from "./runs";

/**
 * Handle an external HTML / text drop model-first: move the caret to the drop
 * point, then insert through {@link pasteHtmlAtCaret}. Returns `false` for an
 * image drop (the image drop handler owns those) or an empty payload, so the
 * caller can fall through. Text-only drops are wrapped to minimal HTML so they
 * ride the same parse + insert pipeline (formatting, split/merge, tracked
 * `ins`).
 */
export function handleHtmlDrop(ctx: EditorContext, e: DragEvent): boolean {
  const dt = e.dataTransfer;
  if (!dt || hasImageInDataTransfer(dt)) return false;
  const html = dt.getData("text/html");
  const plain = dt.getData("text/plain");
  if (!html && !plain) return false;
  e.preventDefault();
  // Move the model caret to the drop point (best-effort — falls back to the
  // current selection where the platform lacks caretRangeFromPoint, e.g. jsdom).
  const range = caretRangeFromPoint(e.clientX, e.clientY);
  if (range) {
    const pos = positionFromDomPoint(
      ctx._hosts(),
      ctx.registry,
      range.startContainer,
      range.startOffset,
    );
    if (pos) ctx.selection.set({ kind: "caret", at: pos });
  }
  if (html && pasteHtmlAtCaret(ctx, html)) return true;
  if (plain) pasteHtmlAtCaret(ctx, plainToHtml(plain));
  return true; // consumed — we prevented the native drop
}

/** Escape a plain-text drop into minimal per-line `<p>` HTML so it rides the
 *  same parse + insert pipeline as a rich paste (blank lines preserved). */
function plainToHtml(text: string): string {
  return text
    .split(/\r\n?|\n/)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Model-first internal drag-MOVE: a selection dragged WITHIN the editor is moved
 * (delete source + insert at the drop) through the ops API rather than the
 * native contentEditable move + read-back. Handles a SAME-BLOCK source only;
 * a cross-block source returns `false` so the caller falls back to native (the
 * cross-block delete+insert range math is a further step). `source` is the
 * selection captured at `dragstart`.
 */
export function handleInternalDragMove(
  ctx: EditorContext,
  e: DragEvent,
  source: ApiRange | null,
): boolean {
  if (!source || source.from.block.id !== source.to.block.id) return false;
  const dt = e.dataTransfer;
  const html = dt?.getData("text/html");
  const plain = dt?.getData("text/plain");
  const markup = html || (plain ? plainToHtml(plain) : "");
  if (!markup) return false;
  const range = caretRangeFromPoint(e.clientX, e.clientY);
  if (!range) return false;
  const drop = positionFromDomPoint(
    ctx._hosts(),
    ctx.registry,
    range.startContainer,
    range.startOffset,
  );
  if (!drop) return false;
  e.preventDefault();
  moveContent(ctx, source, drop, markup);
  return true;
}

/**
 * Delete `source` and insert `html` at `drop`, adjusting the drop offset for the
 * deletion. Dropping inside (or at the edge of) the source is a no-op. Factored
 * out of {@link handleInternalDragMove} so the move logic is testable without a
 * layout (jsdom has no `caretRangeFromPoint`).
 */
export function moveContent(
  ctx: EditorContext,
  source: ApiRange,
  drop: InlinePosition,
  html: string,
): void {
  const sameBlock = drop.block.id === source.from.block.id;
  const lo = Math.min(source.from.offset, source.to.offset);
  const hi = Math.max(source.from.offset, source.to.offset);
  // Drop within/at the edge of the moved range → nothing to do.
  if (sameBlock && drop.offset >= lo && drop.offset <= hi) return;
  if (!deleteRange(ctx, source).ok) return;
  // Deleting the source shifts a same-block drop that sat AFTER it left by the
  // removed length; a drop before it, or in another block, is unaffected.
  const offset = sameBlock && drop.offset > hi ? drop.offset - (hi - lo) : drop.offset;
  const ref = ctx.registry.refById(drop.block.id);
  if (!ref) return;
  ctx.selection.set({ kind: "caret", at: { block: ref, offset } });
  pasteHtmlAtCaret(ctx, html);
}
