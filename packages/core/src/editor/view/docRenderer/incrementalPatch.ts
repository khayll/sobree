/**
 * In-place block patching — the render half of model-first editing (Phase 3 of
 * `devdocs/plan-model-first-editing.md`).
 *
 * `commit()` used to re-render the WHOLE body into paper 0 on every edit
 * (`host.replaceChildren()`), collapsing the paginated DOM so the paginator had
 * to redistribute from scratch. That defeats the incremental-pagination skip
 * (PR 3a): the skip only fires when block nodes keep their identity across an
 * edit. This patches only the CHANGED blocks in place, in whatever paper they
 * live, leaving every other paper untouched — so the pagination survives and an
 * edit that moved no break skips the re-flow entirely.
 *
 * Only the changed blocks are rendered (via {@link renderBlockForPatch}), not
 * the whole doc — so the per-edit cost is O(changed blocks), and no images are
 * re-rendered unless they're inside an edited block.
 *
 * The morph rule preserves node identity where it matters:
 *   - Same tag + same block-level attributes (the run-level case: typing,
 *     inline formatting — only the block's CHILDREN changed) → keep the live
 *     node, swap its children. Reference identity survives, so PR 3a's skip
 *     sees the same node and skips when its height didn't change.
 *   - Otherwise (a block-level attribute changed — alignment, style, a
 *     structural attr) → replace the node. Correct, but the new reference makes
 *     the paginator re-flow (acceptable: property edits are rarer and usually
 *     change geometry anyway).
 *
 * Correctness: each patched block is byte-identical to a full render (enforced
 * by the "incremental render === full render" test); unchanged blocks keep
 * nodes the caller already proved byte-identical (the reuse gate). So the
 * patched DOM equals a full render — the invariant the PR guards.
 */

import type { SobreeDocument } from "../../../doc/types";
import { renderBlockForPatch } from "./block";

/**
 * Patch the `changedIds` blocks of `doc` in place across `hosts`. Returns
 * `false` when a changed block can't be patched safely — missing, split into
 * multiple fragments across papers, or a kind `renderBlockForPatch` doesn't
 * handle (only paragraphs / list items) — so the caller falls back to the full
 * wipe-and-render path.
 */
export function patchChangedBlocksInPlace(
  doc: SobreeDocument,
  hosts: readonly HTMLElement[],
  blockIds: readonly string[],
  changedIds: ReadonlySet<string>,
): boolean {
  if (changedIds.size === 0) return true;

  // Resolve + render every target first so a mid-loop bail leaves the live DOM
  // untouched (all-or-nothing patch; the caller's fallback then re-renders).
  const patches: Array<{ live: HTMLElement; fresh: HTMLElement }> = [];
  for (const id of changedIds) {
    const live = liveBlock(hosts, id);
    // `live === null` means missing OR split into multiple fragments (a
    // paragraph straddling a page break): either way, not safe to patch here.
    if (!live) return false;
    const index = blockIds.indexOf(id);
    const block = index >= 0 ? doc.body[index] : undefined;
    if (!block) return false;
    const fresh = renderBlockForPatch(block, id, live, index, doc);
    if (!fresh) return false; // a kind the single-block renderer doesn't handle
    patches.push({ live, fresh });
  }
  for (const { live, fresh } of patches) morphBlockInPlace(live, fresh);
  return true;
}

/** The single live element carrying `id`, or `null` if absent OR present more
 *  than once (a split fragment) — the caller falls back to a full render for
 *  those, rather than guess which fragment to patch. */
function liveBlock(hosts: readonly HTMLElement[], id: string): HTMLElement | null {
  let found: HTMLElement | null = null;
  for (const host of hosts) {
    for (const el of host.querySelectorAll<HTMLElement>("[data-block-id]")) {
      if (el.getAttribute("data-block-id") !== id) continue;
      // A cell paragraph carries data-block-id too; only match top-level blocks
      // (a direct child of a content host or a list/column wrapper in one).
      if (!isTopLevelBlock(el, host)) continue;
      if (found) return null; // split fragment — bail
      found = el;
    }
  }
  return found;
}

/** True when `el` is a top-level rendered unit (a direct child of the content
 *  host, or of a list / column wrapper that is) — not a nested cell block. */
function isTopLevelBlock(el: HTMLElement, host: HTMLElement): boolean {
  const parent = el.parentElement;
  if (!parent) return false;
  if (parent === host) return true;
  return parent.parentElement === host && !parent.hasAttribute("data-block-id");
}

/**
 * Make `live` match `fresh`. Keeps `live`'s node identity when only its
 * children changed (see the module doc); replaces it outright when a
 * block-level attribute differs.
 */
function morphBlockInPlace(live: HTMLElement, fresh: HTMLElement): void {
  if (live.tagName !== fresh.tagName || !sameAttributes(live, fresh)) {
    live.replaceWith(fresh);
    return;
  }
  // `fresh.childNodes` is live; spreading moves each node onto `live`.
  live.replaceChildren(...Array.from(fresh.childNodes));
}

/** Same attribute names and values on both elements (order-independent). */
function sameAttributes(a: HTMLElement, b: HTMLElement): boolean {
  if (a.attributes.length !== b.attributes.length) return false;
  for (const attr of Array.from(a.attributes)) {
    if (b.getAttribute(attr.name) !== attr.value) return false;
  }
  return true;
}
