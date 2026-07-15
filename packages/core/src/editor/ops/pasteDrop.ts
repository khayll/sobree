/**
 * External HTML / text DROP → model-first insert (Phase 3-7). A thin DragEvent
 * adapter: map the drop point to a model caret, then hand off to the paste
 * insertion pipeline. Image drops and internal drag-MOVE (delete-then-insert)
 * are handled elsewhere.
 */

import type { EditorContext } from "../context";
import { caretRangeFromPoint, hasImageInDataTransfer } from "../dom";
import { positionFromDomPoint } from "../internal/positionMap";
import { pasteHtmlAtCaret } from "./pasteInsert";

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
