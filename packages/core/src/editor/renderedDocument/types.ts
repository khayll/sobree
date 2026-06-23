/**
 * Typed contract for the rendered-document lookup surface.
 *
 * `editor.renderedDocument` answers one question: *given an element in
 * the rendered DOM, what Sobree document concept does it represent?* —
 * and the inverse, *where is the element for this document concept?*
 *
 * It is the sanctioned bridge between the renderer's private DOM shape
 * and plugins (`block-tools`, `review`, and third-party). Plugins call
 * these methods instead of querying renderer attributes directly, so the
 * renderer can evolve its DOM without breaking them.
 */

import type { BlockRef } from "../../doc/api";

/** Which kind of tracked-change a rendered revision mark represents. */
export type RenderedRevisionKind = "inline-insert" | "inline-delete" | "paragraph" | "format";

/** A tracked-change mark discovered in the rendered DOM. */
export interface RenderedRevisionMark {
  /** What the mark represents — inline insert/delete, a paragraph-mark
   *  revision, or a run format change. */
  kind: RenderedRevisionKind;
  /** The element carrying the mark (the `<ins>`/`<del>`, the format
   *  `<span>`, or the paragraph block element). */
  element: HTMLElement;
  /** Revision author, when stamped. */
  author?: string;
  /** Revision date (ISO string), when stamped. */
  date?: string;
  /** Ref of the block the mark lives in, when resolvable. */
  blockRef?: BlockRef;
}

/** A comment-range highlight discovered in the rendered DOM. */
export interface RenderedCommentRange {
  /** The wrapping highlight `<span>`. */
  element: HTMLElement;
  /** Ids of every comment anchored to this range (a range may carry
   *  more than one when comment ranges overlap). */
  commentIds: string[];
  /** Ref of the block the range lives in, when resolvable. */
  blockRef?: BlockRef;
}

/** Map between rendered block elements and document block refs. */
export interface RenderedBlockLookup {
  /** Element for a block ref, or `null` if not currently rendered. */
  elementForBlock(ref: BlockRef): HTMLElement | null;
  /** Element for a block id, or `null` if not currently rendered. */
  elementForBlockId(blockId: string): HTMLElement | null;
  /** Ref of the nearest block ancestor of `element` (a live, versioned
   *  ref), or `null` if `element` isn't inside a rendered block. */
  blockRefFromElement(element: Element): BlockRef | null;
  /** Id of the nearest block ancestor of `element`, or `null`. */
  blockIdFromElement(element: Element): string | null;
}

/** Discover tracked-change marks in the rendered DOM. */
export interface RenderedRevisionLookup {
  /** Every revision mark under `root` (defaults to the whole document). */
  revisionMarks(root?: ParentNode): RenderedRevisionMark[];
  /** The nearest revision mark at or above `target`, or `null`. Inline
   *  marks win over format, which win over paragraph — matching the
   *  nesting order the renderer produces. */
  nearestRevisionMark(target: Element): RenderedRevisionMark | null;
}

/** Discover comment ranges in the rendered DOM. */
export interface RenderedCommentLookup {
  /** Every comment range under `root` (defaults to the whole document). */
  commentRanges(root?: ParentNode): RenderedCommentRange[];
  /** The nearest comment range at or above `target`, or `null`. */
  nearestCommentRange(target: Element): RenderedCommentRange | null;
}

/** The combined rendered-document lookup surface (`editor.renderedDocument`). */
export interface RenderedDocumentIndex
  extends RenderedBlockLookup,
    RenderedRevisionLookup,
    RenderedCommentLookup {}
