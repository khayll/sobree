/**
 * Measurement pass: rendered DOM blocks → `BlockMeasurement[]`.
 *
 * Called ONCE per pagination run. Reads `offsetHeight` / `offsetTop` /
 * `getComputedStyle` and the renderer's already-stamped data-attributes
 * (`data-block-index`, `data-page-break-before`, `data-keep-next`,
 * `data-keep-together`). Does NOT mutate the DOM beyond filling in a
 * stable `data-meas-id` when the renderer didn't provide a usable id.
 *
 * The output is the engine's only view of the document. From here on,
 * the engine never reads the DOM — measurements are the source of
 * truth for height, splittability, and constraint flags.
 *
 * This module knows about HTML element shapes (`<p>`, `<ol>`/`<ul>`,
 * `<table>`) but produces NO Item / Box / Glue / Penalty. The translation
 * to the engine's stream shape lives in `engine.ts` (Step 3).
 */

import { measureParagraphLines } from "../paginationAdapter/paragraphLines";
import type { BlockMeasurement, SplitPoint } from "./types";

/**
 * Measure a flat list of top-level block elements.
 *
 * `blocks` is the same `HTMLElement[]` shape `paginateBlocks` takes
 * today — caller's responsibility to filter to direct flow children of
 * the source paper-content.
 */
export function measureBlocks(blocks: readonly HTMLElement[]): BlockMeasurement[] {
  const out: BlockMeasurement[] = [];
  // Running vertical position so gapBefore reflects the REAL post
  // margin-collapse distance, not naïvely summed margins. Mirrors
  // buildItems' approach so we don't regress the gap measurements
  // that the engine optimises around.
  let prevBottom = 0;
  for (let i = 0; i < blocks.length; i++) {
    const el = blocks[i];
    if (!el) continue;

    const cs = getComputedStyle(el);
    const outOfFlow = cs.position === "absolute" || cs.position === "fixed";

    const gapBefore = outOfFlow ? 0 : Math.max(0, el.offsetTop - prevBottom);
    const m = measureOne(el, i, gapBefore, outOfFlow);
    out.push(m);

    if (!outOfFlow) {
      prevBottom = el.offsetTop + el.offsetHeight;
    }
  }
  return out;
}

function measureOne(
  el: HTMLElement,
  index: number,
  gapBefore: number,
  outOfFlow: boolean,
): BlockMeasurement {
  const blockId = ensureMeasurementId(el, index);
  const pageBreakBefore = el.hasAttribute("data-page-break-before") || isPageBreakMarker(el);
  const keepWithNext = isKeepWithNext(el);
  const keepTogether = isKeepTogetherGroup(el);

  // Out-of-flow elements contribute 0 to budget and have no internal
  // structure the engine cares about. The DOM applicator still moves
  // them to the correct page (typically via their anchor paragraph's
  // page).
  if (outOfFlow) {
    return {
      blockId,
      height: 0,
      gapBefore,
      outOfFlow: true,
      ...(pageBreakBefore ? { pageBreakBefore } : {}),
    };
  }

  const height = measureBlockHeight(el);
  const splitPoints = computeSplitPoints(el);

  const m: BlockMeasurement = { blockId, height, gapBefore };
  if (splitPoints && splitPoints.length > 0) m.splitPoints = splitPoints;
  if (pageBreakBefore) m.pageBreakBefore = true;
  if (keepWithNext) m.keepWithNext = true;
  if (keepTogether) m.keepTogether = true;
  return m;
}

/**
 * Stable identifier the engine + DOM applicator share.
 *
 * Prefers `data-block-index` (already stamped by the renderer per
 * `renderBlocks`). Falls back to a synthesised `meas-N` and writes
 * it back as `data-meas-id` so the applicator can find this exact
 * element after the engine returns.
 *
 * We DON'T parse `data-block-index` because the renderer's index is
 * source-AST-ordinal — meaningful to the AST round-trip but not
 * necessarily unique within a measurement pass (a re-pagination after
 * a section split could re-walk). The id contract is "stable within
 * one measurement → applicator handshake", so we stamp our own.
 */
function ensureMeasurementId(el: HTMLElement, index: number): string {
  const existing = el.dataset.measId;
  if (existing) return existing;
  const fresh = `m${index}`;
  el.dataset.measId = fresh;
  return fresh;
}

/**
 * Block height as the engine should see it.
 *
 * `offsetHeight` is in LOGICAL px (unaffected by ancestor `transform:
 * scale`) — the engine budget is also in logical px. Mixing in
 * `getBoundingClientRect()` here would mis-pack at any zoom.
 *
 * Margin-top is folded in because CSS margin-collapse already
 * accounted for it in `el.offsetTop`, but the next block's gapBefore
 * subtracts `prevBottom = el.offsetTop + el.offsetHeight` — without
 * the margin-top here, the running prevBottom would be one
 * margin-top short for the next iteration.
 */
function measureBlockHeight(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const marginTop = Number.parseFloat(cs.marginTop) || 0;
  return el.offsetHeight + marginTop;
}

/**
 * Compute split points for a splittable block. Returns `undefined` for
 * monolithic blocks.
 *
 *   `<p>` / `<li>` with multiple visual lines → one split point per
 *     non-final line, `yOffset` = cumulative line height.
 *   `<ol>` / `<ul>` → one split point per non-final `<li>`,
 *     `yOffset` = LI's bottom relative to the list's top.
 *   `<table>` → one split point per non-final `<tr>`,
 *     `yOffset` = TR's bottom relative to the table's top.
 *   `<figure>` / `.keep-together` / `<pre>` → monolithic (`undefined`).
 *   Everything else → monolithic.
 *
 * The yOffset is the height of the BLOCK PORTION that would land on
 * the page if the engine broke here — i.e. the height accumulated up
 * to AND including the segment ending at this point.
 */
function computeSplitPoints(el: HTMLElement): SplitPoint[] | undefined {
  if (isMonolithic(el)) return undefined;
  const tag = el.tagName;
  if (tag === "P") return paragraphLineSplits(el);
  if (tag === "OL" || tag === "UL") return listItemSplits(el);
  if (tag === "TABLE") return tableRowSplits(el);
  return undefined;
}

function paragraphLineSplits(p: HTMLElement): SplitPoint[] | undefined {
  const lines = measureParagraphLines(p);
  if (lines.length <= 1) return undefined;
  const points: SplitPoint[] = [];
  let acc = 0;
  // One split point AFTER each non-final line. The implicit "end of
  // block" boundary after the last line is NOT a split point (it's
  // the block's bottom edge — handled by the engine's normal between-
  // block break candidates).
  for (let i = 0; i < lines.length - 1; i++) {
    acc += lines[i]!.height;
    points.push({
      yOffset: acc,
      segmentId: `L${i}`,
    });
  }
  return points;
}

function listItemSplits(list: HTMLElement): SplitPoint[] | undefined {
  const lis = childrenByTag(list, "LI");
  if (lis.length <= 1) return undefined;
  const points: SplitPoint[] = [];
  const listTop = list.offsetTop;
  for (let i = 0; i < lis.length - 1; i++) {
    const li = lis[i]!;
    // Bottom of THIS li relative to the list's top edge — i.e. height
    // the page would consume if we broke after this li.
    const liBottom = li.offsetTop + li.offsetHeight - listTop;
    points.push({
      yOffset: liBottom,
      segmentId: `LI${i}`,
    });
  }
  return points;
}

function tableRowSplits(table: HTMLElement): SplitPoint[] | undefined {
  // Walk THEAD first, then TBODY — same order the applicator will
  // re-emit per-page table clones. A table with no THEAD/TBODY falls
  // back to direct <tr> children.
  const trs: HTMLElement[] = [];
  for (const section of ["thead", "tbody"] as const) {
    const sec = table.querySelector(`:scope > ${section}`);
    if (!sec) continue;
    for (const child of Array.from(sec.children)) {
      if (child.tagName === "TR" && child instanceof HTMLElement) trs.push(child);
    }
  }
  if (trs.length === 0) {
    for (const child of Array.from(table.children)) {
      if (child.tagName === "TR" && child instanceof HTMLElement) trs.push(child);
    }
  }
  if (trs.length <= 1) return undefined;
  const points: SplitPoint[] = [];
  const tableTop = table.offsetTop;
  for (let i = 0; i < trs.length - 1; i++) {
    const tr = trs[i]!;
    const trBottom = tr.offsetTop + tr.offsetHeight - tableTop;
    points.push({
      yOffset: trBottom,
      segmentId: `R${i}`,
    });
  }
  return points;
}

function childrenByTag(parent: HTMLElement, tag: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const child of Array.from(parent.children)) {
    if (child instanceof HTMLElement && child.tagName === tag) out.push(child);
  }
  return out;
}

function isMonolithic(el: HTMLElement): boolean {
  if (el.tagName === "FIGURE") return true;
  if (el.tagName === "PRE") return true;
  if (el.classList.contains("keep-together")) return true;
  if (el.hasAttribute("data-keep-together")) return true;
  return false;
}

function isKeepTogetherGroup(el: HTMLElement): boolean {
  // Differentiated from isMonolithic for clarity: today they're the
  // same predicate but they may diverge — `keepTogether` could become
  // an internal-structure-known flag while `monolithic` stays
  // structure-opaque.
  return isMonolithic(el);
}

function isKeepWithNext(el: HTMLElement): boolean {
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) return true;
  if (el.hasAttribute("data-keep-next")) return true;
  return false;
}

function isPageBreakMarker(el: HTMLElement): boolean {
  return el.classList.contains("page-break") || el.hasAttribute("data-page-break");
}
