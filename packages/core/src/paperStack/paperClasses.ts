/**
 * The paper-layout DOM protocol — the ONE place the page-stack class
 * names that cross the paperStack ↔ plugin boundary are declared.
 *
 * Two sides import this module:
 *   - the **writer**: `paper.ts` stamps these onto the page elements it
 *     builds,
 *   - the **reader**: `paperLayout.ts` (and, through `sobree.paperLayout`,
 *     the `block-tools` / `review` plugins) queries them.
 *
 * Plugins MUST NOT hardcode these strings — they go through the typed
 * `sobree.paperLayout` surface, the only sanctioned reader. Keeping both
 * sides on these constants means a rename is one edit with compiler-checked
 * callers, never a silent cross-package break (AGENTS.md Rule 0: no class
 * name threaded as a hidden inter-module protocol). Sibling to the
 * rendered-content protocol in `editor/renderedDocument/selectors.ts`;
 * this one is page/paper LAYOUT, that one is document CONTENT identity.
 *
 * Styling (`paperStack.css`) keeps its own literal selectors — CSS is the
 * presentation side, independent of this JS query/stamp protocol.
 */

/** The flex row wrapping one page card plus its side gutters. */
export const CLS_PAPER_ROW = "paper-row";
/** The page card itself (carries page geometry + margins). */
export const CLS_PAPER = "paper";
/** Running-header zone inside a page card. */
export const CLS_PAPER_HEADER = "paper-header";
/** Running-footer zone inside a page card. */
export const CLS_PAPER_FOOTER = "paper-footer";
/** Per-page right-margin gutter — the sanctioned plugin mount slot
 *  (`@sobree/review` fills it with comment cards). */
export const CLS_PAPER_COMMENTS = "paper-comments";
