import { buildItems } from "./buildItems";
import { distributePages } from "./distribute";
import { paginate } from "../../pagination";

/**
 * DOM → pagination-engine adapter for PaperStack.
 *
 *   1. `buildItems` walks the blocks and emits the Item stream — one Box
 *      per block (or one per paragraph line), plus penalties for page-break
 *      markers and monolithic flags for figures / keep-together groups.
 *   2. `paginate` (the pure engine in `src/pagination`) produces Pages.
 *   3. `distributePages` turns Pages into a per-page list of DOM elements,
 *      physically splitting paragraphs that straddle page boundaries.
 *
 * Features honoured:
 *   - Widow/orphan at the line level for `<p>` elements.
 *   - Keep-with-next for headings (h1–h6).
 *   - Keep-together for `<figure>`, `.keep-together`, `[data-keep-together]`.
 *   - Forced page breaks for `.page-break` / `[data-page-break]` markers.
 *   - Tables and code blocks remain monolithic.
 */
export function paginateBlocks(
  blocks: HTMLElement[],
  pageContentHeightPx: number,
  pageHeightsPx?: readonly number[],
): HTMLElement[][] {
  if (blocks.length === 0) return [];
  const items = buildItems(blocks);
  const pages = paginate(items, {
    pageHeight: pageContentHeightPx,
    ...(pageHeightsPx ? { pageHeights: pageHeightsPx } : {}),
  });
  return distributePages(pages);
}
