/**
 * `editor.renderedDocument` — the typed bridge between the renderer's
 * private DOM shape and plugins. See `./types.ts` for the contract and
 * `./selectors.ts` for the protocol attribute/class names (the single
 * place those strings live).
 */

import type { BlockRef } from "../../doc/api";
import type { BlockRegistry } from "../internal/blockRegistry";
import {
  blockIdFromElement,
  blockRefFromElement,
  elementForBlock,
  elementForBlockId,
} from "./blocks";
import { commentRanges, nearestCommentRange } from "./comments";
import { nearestRevisionMark, revisionMarks } from "./revisions";
import type { RenderedCommentRange, RenderedDocumentIndex, RenderedRevisionMark } from "./types";

export type {
  RenderedBlockLookup,
  RenderedCommentLookup,
  RenderedCommentRange,
  RenderedDocumentIndex,
  RenderedRevisionKind,
  RenderedRevisionLookup,
  RenderedRevisionMark,
} from "./types";

/**
 * The slice of Editor internals `RenderedDocument` reads — its
 * decoupling seam, so this module never imports the concrete `Editor`
 * class. `roots()` returns the default search scope (the editor's
 * content hosts, where every block / revision / comment element renders).
 */
export interface RenderedDocumentHost {
  roots(): readonly HTMLElement[];
  registry(): BlockRegistry;
}

/** Concrete `RenderedDocumentIndex` over an editor's rendered DOM. */
export class RenderedDocument implements RenderedDocumentIndex {
  constructor(private readonly host: RenderedDocumentHost) {}

  // --- blocks ---

  elementForBlock(ref: BlockRef): HTMLElement | null {
    return elementForBlock(ref, this.host.roots());
  }

  elementForBlockId(blockId: string): HTMLElement | null {
    return elementForBlockId(blockId, this.host.roots());
  }

  blockRefFromElement(element: Element): BlockRef | null {
    return blockRefFromElement(element, this.host.registry());
  }

  blockIdFromElement(element: Element): string | null {
    return blockIdFromElement(element);
  }

  // --- revisions ---

  revisionMarks(root?: ParentNode): RenderedRevisionMark[] {
    const registry = this.host.registry();
    const scopes = root ? [root] : this.host.roots();
    return scopes.flatMap((s) => revisionMarks(s, registry));
  }

  nearestRevisionMark(target: Element): RenderedRevisionMark | null {
    return nearestRevisionMark(target, this.host.registry());
  }

  // --- comments ---

  commentRanges(root?: ParentNode): RenderedCommentRange[] {
    const registry = this.host.registry();
    const scopes = root ? [root] : this.host.roots();
    return scopes.flatMap((s) => commentRanges(s, registry));
  }

  nearestCommentRange(target: Element): RenderedCommentRange | null {
    return nearestCommentRange(target, this.host.registry());
  }
}
