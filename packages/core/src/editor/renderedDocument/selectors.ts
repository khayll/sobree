/**
 * The rendered-DOM protocol — the ONE place the attribute/class names
 * that cross the renderer ↔ plugin boundary are declared.
 *
 * Two sides import this module:
 *   - the **writer**: `view/docRenderer/*` stamps these onto rendered
 *     elements,
 *   - the **reader**: `renderedDocument/*` (and, through it, the
 *     `block-tools` / `review` plugins) queries them.
 *
 * Plugins MUST NOT hardcode these strings — they go through the typed
 * `editor.renderedDocument` surface, which is the only sanctioned reader.
 * Keeping both sides on these constants means a rename is one edit with
 * compiler-checked callers, never a silent cross-package break (AGENTS.md
 * Rule 0: no `data-*` threaded as an inter-module protocol).
 *
 * Scope is deliberately narrow: only attributes/classes that are read
 * across the package boundary live here. Purely-internal renderer
 * attributes (layout/flow markers like `data-col-count`, `data-page-break`)
 * stay local to their module.
 */

// --- block identity ---
export const BLOCK_ID_ATTR = "data-block-id";

// --- paragraph-mark revisions (stamped on the block element) ---
export const BLOCK_REVISION_ATTR = "data-block-revision";
export const BLOCK_REVISION_AUTHOR_ATTR = "data-block-revision-author";
export const BLOCK_REVISION_DATE_ATTR = "data-block-revision-date";

// --- inline ins/del revisions (stamped on the <ins>/<del> wrapper) ---
export const REVISION_AUTHOR_ATTR = "data-revision-author";
export const REVISION_DATE_ATTR = "data-revision-date";

// --- format-change revisions (stamped on the wrapping <span>) ---
export const REVISION_FORMAT_AUTHOR_ATTR = "data-revision-format-author";
export const REVISION_FORMAT_DATE_ATTR = "data-revision-format-date";

// --- comment ranges (stamped on the wrapping <span>) ---
export const COMMENT_IDS_ATTR = "data-comment-ids";

// --- protocol class names ---
export const CLS_REVISION = "sobree-revision"; // inline ins/del wrapper
export const CLS_REVISION_FORMAT = "sobree-revision-format";
export const CLS_COMMENT_RANGE = "sobree-comment-range";

// --- derived query selectors ---

/** Matches every inline tracked-change wrapper (`<ins>` / `<del>`). */
export const INLINE_REVISION_SELECTOR = `ins[${REVISION_AUTHOR_ATTR}], del[${REVISION_AUTHOR_ATTR}]`;

/** Matches every paragraph-mark revision (the block element). */
export const BLOCK_REVISION_SELECTOR = `[${BLOCK_REVISION_ATTR}]`;

/** Matches every format-change wrapper. */
export const FORMAT_REVISION_SELECTOR = `span.${CLS_REVISION_FORMAT}`;

/** Matches every comment-range highlight wrapper. */
export const COMMENT_RANGE_SELECTOR = `.${CLS_COMMENT_RANGE}`;

/** Matches any element carrying a block id (the nearest block ancestor). */
export const BLOCK_ID_SELECTOR = `[${BLOCK_ID_ATTR}]`;

/** Selector for the element bearing a specific block id. */
export function blockIdSelector(id: string): string {
  return `[${BLOCK_ID_ATTR}="${cssEscape(id)}"]`;
}

/**
 * Minimal `CSS.escape` fallback for environments without it (jsdom,
 * older browsers). Block ids are alphanumeric + underscore in practice,
 * so a tight regex suffices.
 */
export function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}
