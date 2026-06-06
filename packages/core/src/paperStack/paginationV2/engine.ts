/**
 * Engine bridge: `BlockMeasurement[] + PaginationConstraints → PaginatedDoc`.
 *
 * The existing pure engine in `src/pagination/` already accepts an
 * `Item[]` stream and produces `Page[]`. Step 3 of the Phase 2 refactor
 * is to prove the new typed contract is sufficient by routing through
 * the existing engine — translate measurements down to items, call
 * paginate, translate pages back to PaginatedDoc.
 *
 * This is intentionally a thin shim. Forced-break semantics still
 * use the engine's `Penalty(-Infinity)` path; the "first-class
 * forced-break-as-boundary" rewrite (the engine-internal change that
 * makes the page array grow when needed) is a later step that can
 * happen without touching the typed contract.
 */

import { paginate } from "../../pagination";
import type { Box, Config as EngineConfig, Item, Page } from "../../pagination/types";
import type {
  BlockMeasurement,
  PaginatedDoc,
  PaginatedPage,
  PageSegment,
  PaginationConstraints,
  SegmentRange,
  SplitPoint,
} from "./types";

/**
 * Pure paginator over the new typed contract. Determinism, totality,
 * forced-break semantics — all from the existing engine; this wrapper
 * just translates.
 */
export function paginateMeasurements(
  measurements: ReadonlyArray<BlockMeasurement>,
  constraints: PaginationConstraints,
): PaginatedDoc {
  if (measurements.length === 0) {
    return { pages: [], totalCost: 0, grewPageArray: false };
  }
  const { items, boxes } = measurementsToItems(measurements);
  const cfg = constraintsToEngineConfig(constraints);
  const pages = paginate(items, cfg);
  return pagesToDoc(pages, boxes, constraints);
}

// ─── measurements → items ────────────────────────────────────────────────

/**
 * Side-table entry: maps a single emitted Box back to its source
 * block + segment. Stored in array index order, parallel to the order
 * of boxes in the emitted item stream — looked up by counting boxes
 * as we walk pages.
 */
interface BoxMeta {
  blockId: string;
  /** Defined only for split-block segments (paragraph lines, LIs, TRs). */
  segmentId?: string;
}

interface BuildResult {
  items: Item[];
  /** One entry per Box emitted, in emission order. */
  boxes: BoxMeta[];
}

function measurementsToItems(measurements: ReadonlyArray<BlockMeasurement>): BuildResult {
  const items: Item[] = [];
  const boxes: BoxMeta[] = [];

  for (let i = 0; i < measurements.length; i++) {
    const m = measurements[i]!;

    // Inter-block glue. The first block has no preceding glue; the
    // engine's existing behaviour treats inter-block positions as
    // candidate breaks via the glue, so we keep emitting glue between
    // every pair (even gap = 0 ⇒ Glue(0), which costs nothing but
    // opens a break candidate at exactly that position).
    if (i > 0) {
      items.push({ type: "glue", height: m.gapBefore });
    }

    // Forced page break BEFORE this block: emit a Penalty(-Infinity).
    // The engine's existing forced-break path consumes this and starts
    // the block on a new page. (Caveat the contract doc lists: if
    // honouring this would overflow the page array, the current
    // engine silently truncates; Step 3 wraps that quirk through —
    // Step 4+ can rewrite the engine to grow the array.)
    if (m.pageBreakBefore) {
      items.push({ type: "penalty", cost: Number.NEGATIVE_INFINITY });
    }

    // The block itself. Out-of-flow blocks become a single zero-height
    // box. Monolithic blocks become a single box. Split blocks become
    // one box per segment, sharing the paragraphId = blockId so
    // widow/orphan grouping works as before.
    if (m.outOfFlow) {
      pushBox(items, boxes, { type: "box", height: 0, paragraphId: m.blockId }, m.blockId);
      continue;
    }

    const splits = m.splitPoints;
    if (!splits || splits.length === 0) {
      // Monolithic block.
      const box: Box = {
        type: "box",
        height: m.height,
        paragraphId: m.blockId,
        monolithic: true,
        ...(m.keepWithNext ? { keepWithNext: true } : {}),
        ...(m.keepTogether ? { keepTogether: true } : {}),
      };
      pushBox(items, boxes, box, m.blockId);
      continue;
    }

    // Split block: emit one box per segment. Segment heights are the
    // increments between consecutive yOffsets, with the final segment
    // running from the last split's yOffset to the block's bottom.
    const segments = splitBlockSegments(m.height, splits);
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s]!;
      const isFirst = s === 0;
      const isLast = s === segments.length - 1;
      const box: Box = {
        type: "box",
        height: seg.height,
        paragraphId: m.blockId,
        isFirstLineOfParagraph: isFirst,
        isLastLineOfParagraph: isLast,
        ...(isLast && m.keepWithNext ? { keepWithNext: true } : {}),
        ...(m.keepTogether ? { keepTogether: true } : {}),
      };
      pushBox(items, boxes, box, m.blockId, seg.segmentId);
      // Glue(0) between segments → engine sees a break candidate at
      // every segment boundary. Mirrors today's per-line/per-li/per-tr
      // glue insertion in buildItems.
      if (!isLast) items.push({ type: "glue", height: 0 });
    }
  }

  return { items, boxes };
}

interface SegmentSpec {
  height: number;
  segmentId: string;
}

/**
 * Resolve `(blockHeight, splitPoints)` into the actual per-segment
 * height slices. `splitPoints[i].yOffset` is the cumulative height up
 * through segment `i`'s end (so segment `i`'s height is
 * `yOffset[i] - yOffset[i-1]`). The final segment runs from the last
 * split's yOffset to `blockHeight` — it gets a synthesised segmentId
 * (`LAST`) because the SplitPoint array, by definition, never
 * includes the implicit end-of-block boundary.
 *
 * The synthesised id IS stable per re-run (deterministic from the
 * input) so two pagination passes over the same measurements produce
 * the same partition — important for snapshot stability.
 */
function splitBlockSegments(blockHeight: number, splits: ReadonlyArray<SplitPoint>): SegmentSpec[] {
  const out: SegmentSpec[] = [];
  let prevY = 0;
  for (const sp of splits) {
    out.push({ height: Math.max(0, sp.yOffset - prevY), segmentId: sp.segmentId });
    prevY = sp.yOffset;
  }
  out.push({ height: Math.max(0, blockHeight - prevY), segmentId: LAST_SEGMENT_ID });
  return out;
}

/**
 * Sentinel segmentId for the implicit final segment of a split block.
 * Picked so it doesn't collide with the deterministic ids the
 * measurement pass emits (`L0`, `LI0`, `R0`, …).
 */
const LAST_SEGMENT_ID = "_END";

function pushBox(
  items: Item[],
  boxes: BoxMeta[],
  box: Box,
  blockId: string,
  segmentId?: string,
): void {
  items.push(box);
  boxes.push(segmentId === undefined ? { blockId } : { blockId, segmentId });
}

// ─── pages → PaginatedDoc ────────────────────────────────────────────────

/**
 * Walk the engine's `Page[]` and group consecutive Box items into
 * PageSegments. Boxes from the same block on the same page merge into
 * a single segment with a range; boxes from a block that's whole on
 * one page produce a segment with no range.
 *
 * The boxIndex counter advances ONLY when we encounter Box items —
 * Glue and Penalty don't carry box metadata.
 */
function pagesToDoc(
  pages: Page[],
  boxes: BoxMeta[],
  constraints: PaginationConstraints,
): PaginatedDoc {
  let boxIndex = 0;
  let totalCost = 0;
  const outPages: PaginatedPage[] = [];

  for (const page of pages) {
    totalCost += page.cost;
    const segments: PageSegment[] = [];

    // Group consecutive boxes sharing the same blockId into one
    // segment. range is set iff the block was split (i.e. at least
    // one box of this block carries a segmentId — which is true for
    // any block whose measurement had splitPoints).
    let curBlockId: string | null = null;
    let curStartSegId: string | undefined;
    let curEndSegId: string | undefined;

    const flush = () => {
      if (curBlockId === null) return;
      const seg: PageSegment = { blockId: curBlockId };
      if (curStartSegId !== undefined && curEndSegId !== undefined) {
        const range: SegmentRange = { startSegmentId: curStartSegId, endSegmentId: curEndSegId };
        seg.range = range;
      }
      segments.push(seg);
      curBlockId = null;
      curStartSegId = undefined;
      curEndSegId = undefined;
    };

    for (const item of page.items) {
      if (item.type !== "box") continue;
      const meta = boxes[boxIndex++];
      if (!meta) continue;
      if (meta.blockId !== curBlockId) {
        flush();
        curBlockId = meta.blockId;
        curStartSegId = meta.segmentId;
        curEndSegId = meta.segmentId;
      } else {
        curEndSegId = meta.segmentId;
      }
    }
    flush();

    outPages.push({
      segments,
      usedHeight: page.usedHeight,
    });
  }

  const grewPageArray = outPages.length > constraints.pageHeights.length;
  return {
    pages: outPages,
    totalCost,
    grewPageArray,
  };
}

// ─── config translation ──────────────────────────────────────────────────

function constraintsToEngineConfig(c: PaginationConstraints): EngineConfig {
  const cfg: EngineConfig = {
    pageHeight: c.defaultPageHeight,
  };
  if (c.pageHeights.length > 0) cfg.pageHeights = c.pageHeights;
  if (c.widows !== undefined) cfg.widows = c.widows;
  if (c.orphans !== undefined) cfg.orphans = c.orphans;
  if (c.widowOrphanPenalty !== undefined) cfg.widowOrphanPenalty = c.widowOrphanPenalty;
  if (c.keepPenalty !== undefined) cfg.keepPenalty = c.keepPenalty;
  return cfg;
}
