/**
 * Rendered block ↔ document block-ref mapping. Pure functions over a
 * search scope + the `BlockRegistry` (for the live version number).
 */

import type { BlockRef } from "../../doc/api";
import type { BlockRegistry } from "../internal/blockRegistry";
import { BLOCK_ID_ATTR, BLOCK_ID_SELECTOR, blockIdSelector } from "./selectors";

/** Id of the nearest block ancestor of `el` (including `el`), or `null`. */
export function blockIdFromElement(el: Element): string | null {
  const block = el.closest(BLOCK_ID_SELECTOR);
  return block?.getAttribute(BLOCK_ID_ATTR) ?? null;
}

/**
 * Live, versioned ref of the nearest block ancestor of `el`, or `null`.
 * Returns `null` when the id isn't live in the registry (e.g. the block
 * was just deleted) — the registry is the source of truth for versions.
 */
export function blockRefFromElement(el: Element, registry: BlockRegistry): BlockRef | null {
  const id = blockIdFromElement(el);
  return id ? registry.refById(id) : null;
}

/** Rendered element bearing `blockId`, searched across `roots`, or `null`. */
export function elementForBlockId(
  blockId: string,
  roots: readonly ParentNode[],
): HTMLElement | null {
  const sel = blockIdSelector(blockId);
  for (const root of roots) {
    const found = root.querySelector<HTMLElement>(sel);
    if (found) return found;
  }
  return null;
}

/** Rendered element for a block ref (matched by id), or `null`. */
export function elementForBlock(ref: BlockRef, roots: readonly ParentNode[]): HTMLElement | null {
  return elementForBlockId(ref.id, roots);
}
