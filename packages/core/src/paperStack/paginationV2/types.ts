/**
 * Phase 2 paginator contract — the typed boundary between the renderer
 * and the pagination engine.
 *
 * Today's flow (the layer this replaces):
 *
 *   blocks: HTMLElement[]
 *     → buildItems()           (reads live DOM `offsetHeight`,
 *                               stamps `data-pag-*` ids,
 *                               emits an Item[] stream)
 *     → paginate()             (the pure engine — already first-class)
 *     → distributePages()      (mutates DOM: splits <p>/<ol>/<table>)
 *     → collapse*Pages()       (post-process passes that re-read heights
 *                               from blocks in the WRONG DOM context,
 *                               source of the worst recurring bugs)
 *
 * Why that's wrong (recorded in `packages/core/docs/SESSION_HANDOFF.md`):
 *   - Forced breaks are smuggled in as `Penalty(-Infinity)` inside the
 *     Item stream, NOT as first-class constraints. The engine can
 *     refuse to grow the page array when honouring them would create
 *     overflow — so a `<w:pageBreakBefore/>` that doesn't fit silently
 *     shortens the document.
 *   - Inter-module signalling is ad-hoc: `data-page-break-before`,
 *     `data-keep-next`, `data-pag-pid`, `data-pag-lid`, `data-pag-tid`,
 *     `.keep-together`, etc. — none of it typed.
 *   - The post-process passes re-measure block heights after some
 *     blocks have moved and others haven't, producing nonsense values
 *     (a 268px table measured as 36px in firstContent → mistakenly
 *     classified as a widow → absorbed onto the previous page → 268px
 *     overflow into the footer band).
 *
 * The new contract:
 *
 *   BlockMeasurement[]                ← computed ONCE from source DOM
 *   PaginationConstraints             ← typed budget + rules
 *     → purePaginate()                ← engine: pure (measurements,
 *                                       constraints) → PaginatedDoc
 *   PaginatedDoc                      ← partition, NOT a DOM mutation
 *     → applyPaginatedDoc()           ← single DOM pass: splits + moves
 *
 * Pure. Typed. Forced-breaks-as-boundaries. One DOM mutation pass.
 *
 * This file is types only. The measurement pass, engine wrapper, and
 * DOM applicator land in sibling files in subsequent steps and are
 * gated behind a flag until per-fixture verification passes.
 */

/**
 * One block as the paginator sees it. All quantities are pre-measured;
 * the engine NEVER reads the DOM.
 *
 * Multi-line paragraphs, multi-item lists, multi-row tables are SINGLE
 * BlockMeasurements with non-empty `splitPoints` — the engine breaks
 * within the block when it chooses one of those points.
 */
export interface BlockMeasurement {
  /**
   * Stable identifier. The engine refers to blocks (and segments within
   * blocks) only by id — never by DOM reference. The DOM applicator
   * holds the `blockId → HTMLElement` map.
   *
   * Ids must be stable across pagination retries (footnote-zone budget
   * recalc, e.g.). Caller's choice; typically derived from the source
   * AST's `block-index` or from the rendered DOM's `data-block-index`.
   */
  blockId: string;

  /**
   * Natural rendered height of this block in CSS px when placed in its
   * canonical context (the source paper's `.paper-content`). Measured
   * once by the measurement pass.
   *
   * For a splittable block (paragraph with multiple lines, list with
   * multiple items, table with multiple rows), this is the height when
   * the WHOLE block lands on one page. When the engine chooses to split
   * at a `splitPoint`, the page-end segment's height is
   * `splitPoint.yOffset`; the next-page segment's height is
   * `height - splitPoint.yOffset`.
   */
  height: number;

  /**
   * Inter-block gap that appears BEFORE this block in flow — the
   * post-margin-collapse vertical distance between the previous block's
   * bottom and this block's top. Encoded as Glue in the engine's
   * stream; counted against page height only between non-trailing
   * blocks (trailing glue discards at page boundaries).
   *
   * 0 for the first block in the stream.
   */
  gapBefore: number;

  /**
   * Points at which the engine may break this block across pages.
   * Empty / undefined → the block is monolithic (whole thing moves
   * together). For paragraphs, one entry per line break. For lists,
   * one per `<li>`. For tables, one per `<tr>`.
   *
   * The yOffset is the height consumed by the on-page side of the
   * split, measured from the block's top edge. The breakpoint after
   * the LAST line/item/row is implicit (it's the block's bottom edge)
   * and not included.
   */
  splitPoints?: ReadonlyArray<SplitPoint>;

  /**
   * The block carries an explicit forced page break BEFORE it
   * (`<w:pageBreakBefore/>` on the paragraph, or
   * `<w:br w:type="page"/>` in its runs). The engine MUST start a new
   * page at this block — and MUST grow the page array if the previous
   * page is already full.
   *
   * This is the field forced-break semantics hang on. The engine
   * doesn't read `data-page-break-before` from DOM; it reads this.
   */
  pageBreakBefore?: boolean;

  /**
   * Keep on the same page as the NEXT block in the stream. Heading
   * styles set this so the heading stays with its first content
   * paragraph. If both don't fit, the break moves to BEFORE this
   * block.
   */
  keepWithNext?: boolean;

  /**
   * Keep all of this block's split points together (i.e. the whole
   * block stays on one page). Stronger than monolithic: a
   * `keepTogether` block CAN have splitPoints (so the engine knows
   * the block's internal structure for cost estimation) but is
   * penalised heavily for actually breaking. Used for figures /
   * `.keep-together` groups.
   */
  keepTogether?: boolean;

  /**
   * Out-of-flow blocks (`position: absolute` / `fixed`) contribute 0
   * to the page budget. The engine still emits them in document order
   * so the DOM applicator can route them to the right page, but their
   * height doesn't compete with in-flow content for space.
   *
   * Anchored frames are intended to render via the floating layer
   * (anchorLayer.ts) and not appear here at all; this flag covers the
   * fallback where an out-of-flow block still ended up in the body
   * block stream.
   */
  outOfFlow?: boolean;
}

/**
 * A position within a block where the engine may break across a page
 * boundary. The block stays as one DOM element when not broken; when
 * the engine chooses to break here, the DOM applicator slices it.
 */
export interface SplitPoint {
  /**
   * Height (px) consumed by the on-page portion if the engine breaks
   * AT this point. Equivalently: the position of this break within
   * the block's natural rendered height.
   */
  yOffset: number;

  /**
   * Stable identifier for the on-page segment ending here. For
   * paragraphs, the line index. For lists, the `<li>` index. For
   * tables, the `<tr>` index. The DOM applicator uses this to know
   * where to cut.
   */
  segmentId: string;

  /**
   * Cost added if the engine breaks at this point. 0 = neutral,
   * `Number.POSITIVE_INFINITY` = forbidden. Used for widow / orphan
   * penalties (e.g. forbidding a break that leaves 1 line of a
   * 3-line paragraph alone).
   */
  penalty?: number;
}

/**
 * Engine constraints — the budget and rules the engine optimises
 * within. Separate from `BlockMeasurement[]` so the same stream can
 * be re-paginated under different budgets (footnote-zone recalc)
 * without re-measuring.
 */
export interface PaginationConstraints {
  /**
   * Body-area height for page index `i`, in px. The engine uses
   * `pageHeights[i]` when present, falling back to
   * `defaultPageHeight` for pages beyond the array's length.
   *
   * Today's paginator computes per-page heights iteratively because
   * footnote zones eat budget on specific pages; that signal flows in
   * here once, instead of being re-discovered through retry loops.
   */
  pageHeights: ReadonlyArray<number>;

  /** Default body-area height for pages past `pageHeights.length`. */
  defaultPageHeight: number;

  /** Minimum lines of a paragraph that may sit on the new page. Default 1. */
  widows?: number;

  /** Minimum lines of a paragraph that may sit on the current page. Default 1. */
  orphans?: number;

  /**
   * Penalty cost added to breaks that would create a widow or orphan
   * inside `widows` / `orphans` limits. Default 10000 — high enough
   * to win against natural breaks but finite so it doesn't escalate
   * to `Infinity` and create unsatisfiable constraints.
   */
  widowOrphanPenalty?: number;

  /**
   * Penalty cost added to breaks inside a `keepWithNext` adjacency or
   * across a `keepTogether` block. Default 10000.
   */
  keepPenalty?: number;
}

/**
 * The paginator's output: a partition of the input stream into pages,
 * expressed as data. NO DOM mutation has happened yet.
 *
 * The DOM applicator reads this and performs the necessary splits +
 * moves in a single pass. Snapshot tests bite at THAT layer.
 */
export interface PaginatedDoc {
  pages: ReadonlyArray<PaginatedPage>;

  /**
   * Sum of penalty costs the engine accepted for this partition.
   * Diagnostic: a high value means widow/orphan/keep rules were
   * violated to satisfy a forced break.
   */
  totalCost: number;

  /**
   * Whether the engine had to grow the page array beyond what the
   * `pageHeights` array sized. True when a forced break landed on a
   * page that wasn't accounted for in the constraints — the caller
   * may want to re-measure footnote zones for the new page.
   */
  grewPageArray: boolean;
}

/**
 * One page's assignment, in document order.
 */
export interface PaginatedPage {
  segments: ReadonlyArray<PageSegment>;

  /**
   * Total height the engine packed onto this page, excluding trailing
   * glue. Useful for the DOM applicator to know how much space the
   * placed content needs (e.g. for vertical alignment within the
   * paper-content box).
   */
  usedHeight: number;
}

/**
 * One block's contribution to a page. When `range` is absent the
 * whole block lands here. When present, only the slice from
 * `startSegmentId` (exclusive of any earlier-page slice) to
 * `endSegmentId` (last segment on this page) lands here.
 *
 * Continuation across pages of the same block is recognised by
 * matching `blockId` between adjacent pages — both halves carry the
 * same id; the segment ids tell the DOM applicator where to cut.
 */
export interface PageSegment {
  blockId: string;
  range?: SegmentRange;
}

export interface SegmentRange {
  /** First on-page segment (inclusive). */
  startSegmentId: string;
  /** Last on-page segment (inclusive). */
  endSegmentId: string;
}

/**
 * The pure paginator: typed in, typed out, no I/O, no globals.
 *
 *   - Determinism: same inputs ⇒ same `PaginatedDoc` (modulo undefined
 *     behaviour on tied costs, which the engine MUST resolve in a
 *     stable, documented way — typically by preferring earlier breaks).
 *   - Totality: defined for every legal input. Empty `measurements` ⇒
 *     `{ pages: [], totalCost: 0, grewPageArray: false }`.
 *   - Forced-break correctness: if any `BlockMeasurement` has
 *     `pageBreakBefore: true`, the returned page assignment places it
 *     at the START of some page — never mid-page. The page array
 *     grows as needed.
 */
export type PurePaginate = (
  measurements: ReadonlyArray<BlockMeasurement>,
  constraints: PaginationConstraints,
) => PaginatedDoc;
