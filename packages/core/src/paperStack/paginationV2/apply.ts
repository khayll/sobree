/**
 * DOM applicator: `(PaginatedDoc, sourceBlocks) → HTMLElement[][]`.
 *
 * Takes the engine's typed partition and physically realises it in the
 * DOM. ONE pass, no measurement, no recursion into pagination — every
 * decision was already made by the engine.
 *
 * Three split shapes:
 *   - <p> / <li> with a SegmentRange spanning a page boundary →
 *     `splitElementAtCharOffset` at the start char of the first segment
 *     on the later page.
 *   - <ol> / <ul> with a SegmentRange across LI boundaries → per-page
 *     <ol> / <ul> clones with the right LI subset and `start` attr.
 *   - <table> with a SegmentRange across TR boundaries → per-page
 *     <table> clones with the right TR subset, THEAD repeated.
 *
 * Scope limitation (Step 4): if the engine chose to break inside an
 * <ol> / <ul>, this applicator respects only LI-level split boundaries
 * — mid-LI character splits are NOT applied here. Today's distribute.ts
 * supports nested per-line splits inside LIs; the measure pass for the
 * new contract emits LI-level split points only. Per-fixture
 * verification in Step 5 surfaces whether nested splits matter for the
 * CV corpus — if so, extend measure.ts (and this applicator) to honour
 * `LI{i}:L{j}` nested segment ids in a follow-up.
 */

import { measureParagraphLines } from "../paginationAdapter/paragraphLines";
import { snapToWordBoundary, splitElementAtCharOffset } from "../paginationAdapter/splitParagraph";
import type { PaginatedDoc, SegmentRange } from "./types";

/**
 * Apply a PaginatedDoc to the source DOM. The `sourceBlocks` array
 * must be the SAME elements (same `data-meas-id` stamps) the measure
 * pass walked — the applicator uses the id to resolve a `PageSegment`
 * back to the originating element.
 *
 * Returns one `HTMLElement[]` per page, in the order the page should
 * render. The caller (paperStack) appends these into paper-content boxes.
 *
 * SIDE EFFECTS on the source DOM:
 *   - Paragraph / list-item splits clone the source element, replacing
 *     it with a head fragment in place.
 *   - List / table clones MOVE their LI / TR children out of the source
 *     into per-page clones; the source container is removed if emptied.
 * Source DOM should be treated as consumed after this call.
 */
export function applyPaginatedDoc(
  doc: PaginatedDoc,
  sourceBlocks: readonly HTMLElement[],
): HTMLElement[][] {
  if (doc.pages.length === 0) return [];

  const byId = indexBlocksById(sourceBlocks);

  // Phase 0: snapshot LI / TR children of every list / table block.
  // Phase 2 MOVES children out of source containers into per-page
  // clones. If we re-read `sourceList.children` on the second page,
  // page 0's moves have already depleted it — index `LI2` no longer
  // resolves to the originally-third LI. The snapshot captures the
  // original layout once so each per-page slice maps to the right
  // children.
  const childSnapshots = snapshotChildren(byId);

  // Phase 1: for every blockId that appears across multiple pages,
  // compute the line indices (paragraph lines) or LI indices or TR
  // indices at which the engine chose to break. Then perform splits
  // up front so phase 2 can route the resulting fragments per page
  // without re-measuring.
  const fragments = buildFragmentsMap(doc, byId);

  // Phase 2: build per-page element lists, MOVING LIs into per-page
  // OL / UL containers and TRs into per-page TABLE containers as we go.
  const sourceListsTouched = new Set<HTMLElement>();
  const result: HTMLElement[][] = [];

  for (let pageIdx = 0; pageIdx < doc.pages.length; pageIdx++) {
    const page = doc.pages[pageIdx]!;
    const pageElements: HTMLElement[] = [];

    // Open list / table aggregation state — clears whenever a non-list,
    // non-table block intervenes.
    let openContainerSource: HTMLElement | null = null;
    let openContainerClone: HTMLElement | null = null;

    for (const seg of page.segments) {
      const sourceEl = byId.get(seg.blockId);
      if (!sourceEl) continue;

      // Resolve the fragment for THIS page. Paragraph / LI character
      // splits put per-page fragments into `fragments`. If the block
      // doesn't appear there, use the original element.
      const fragment = fragments.get(seg.blockId)?.get(pageIdx) ?? sourceEl;

      if (isListContainer(sourceEl)) {
        const lis = childSnapshots.get(sourceEl) ?? [];
        appendListContents(
          sourceEl,
          lis,
          fragment,
          seg.range,
          pageElements,
          (sourceList, clone) => {
            openContainerSource = sourceList;
            openContainerClone = clone;
          },
        );
        sourceListsTouched.add(sourceEl);
        continue;
      }

      if (sourceEl.tagName === "TABLE") {
        const trs = childSnapshots.get(sourceEl) ?? [];
        appendTableContents(sourceEl, trs, seg.range, pageElements);
        sourceListsTouched.add(sourceEl);
        openContainerSource = null;
        openContainerClone = null;
        continue;
      }

      // Plain block (paragraph, heading, div, figure, …). Just append
      // the fragment.
      pageElements.push(fragment);
      openContainerSource = null;
      openContainerClone = null;
    }

    // Silence unused-var lint: openContainerSource / openContainerClone
    // are tracked for the list-aggregation shape used by today's
    // distribute. The new shape collapses per-segment list handling
    // inside `appendListContents`; the variables are kept so a future
    // refinement that aggregates contiguous-list segments can use them
    // without restructuring this loop.
    void openContainerSource;
    void openContainerClone;

    result.push(pageElements);
  }

  // Phase 3: clean up source OL / UL / TABLE elements emptied by the
  // distribution.
  for (const src of sourceListsTouched) {
    if (src.tagName === "TABLE") {
      removeIfEmptyTable(src);
    } else if (src.children.length === 0) {
      src.parentElement?.removeChild(src);
    }
  }

  return result;
}

// ─── block-id → element resolution ───────────────────────────────────────

/**
 * Snapshot the splittable children of every list / table block so phase
 * 2 can resolve `LI{N}` / `R{N}` segment ids stably even after earlier
 * pages have already MOVED some children into per-page clones.
 *
 *   - <ol> / <ul> → live snapshot of direct <li> children.
 *   - <table>     → live snapshot of TRs (TBODY rows; falls back to direct
 *                   <tr> children if no TBODY). THEAD rows aren't in the
 *                   snapshot — they're deep-cloned per page, not moved.
 *
 * Returns a Map keyed by the SOURCE element (list / table). Lookups in
 * phase 2 use the source element.
 */
function snapshotChildren(byId: Map<string, HTMLElement>): Map<HTMLElement, HTMLElement[]> {
  const out = new Map<HTMLElement, HTMLElement[]>();
  for (const el of byId.values()) {
    if (isListContainer(el)) {
      out.set(el, childrenByTag(el, "LI"));
    } else if (el.tagName === "TABLE") {
      out.set(el, collectTrs(el));
    }
  }
  return out;
}

function indexBlocksById(blocks: readonly HTMLElement[]): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>();
  for (let i = 0; i < blocks.length; i++) {
    const el = blocks[i];
    if (!el) continue;
    const id = el.dataset.measId;
    if (id) out.set(id, el);
  }
  return out;
}

// ─── fragment construction (paragraph + LI character splits) ─────────────

/**
 * For every block that has segments across multiple pages, compute the
 * resulting per-page fragments by splitting the source element at the
 * appropriate character offsets.
 *
 * Currently handles:
 *   - <p> with `L{i}` segment ids → split at line[i+1] start offset.
 *   - <li> with `L{i}` segment ids (rare under Step 4's measure pass —
 *     reserved for future nested LI splits).
 *
 * <ol> / <ul> and <table> blocks aren't split via this path; their LIs
 * / TRs are routed to per-page containers in phase 2.
 */
function buildFragmentsMap(
  doc: PaginatedDoc,
  byId: Map<string, HTMLElement>,
): Map<string, Map<number, HTMLElement>> {
  // blockId → ordered list of [pageIdx, lastSegOnPageIdx] for blocks
  // appearing on multiple pages.
  const spans = new Map<string, Array<{ pageIdx: number; endSegId: string }>>();
  for (let pageIdx = 0; pageIdx < doc.pages.length; pageIdx++) {
    for (const seg of doc.pages[pageIdx]!.segments) {
      if (!seg.range) continue;
      let entry = spans.get(seg.blockId);
      if (!entry) {
        entry = [];
        spans.set(seg.blockId, entry);
      }
      entry.push({ pageIdx, endSegId: seg.range.endSegmentId });
    }
  }

  const fragments = new Map<string, Map<number, HTMLElement>>();
  for (const [blockId, entries] of spans) {
    if (entries.length < 2) continue; // single-page block — no split needed
    const sourceEl = byId.get(blockId);
    if (!sourceEl) continue;
    // Only paragraph-like (<p>, <li>) splits land in this map. Lists
    // / tables route through phase 2 directly.
    if (sourceEl.tagName !== "P" && sourceEl.tagName !== "LI") continue;
    const map = splitParagraphAcrossPages(sourceEl, entries);
    if (map.size > 0) fragments.set(blockId, map);
  }
  return fragments;
}

/**
 * Split a <p> / <li> at the boundaries between consecutive on-page
 * segments. `entries` lists, in page order, each page's `(pageIdx,
 * endSegmentId)` for this block. We split AFTER each endSegmentId
 * except the last one (which is the trailing fragment).
 *
 * EndSegmentId format from measure.ts is `L{n}`. The split happens at
 * `lines[n + 1].startCharOffset` (the first character of the FIRST
 * line on the next page).
 */
function splitParagraphAcrossPages(
  original: HTMLElement,
  entries: ReadonlyArray<{ pageIdx: number; endSegId: string }>,
): Map<number, HTMLElement> {
  const out = new Map<number, HTMLElement>();
  out.set(entries[0]!.pageIdx, original);

  let currentFragment = original;
  // Lines consumed by previously-applied fragments — line indices in
  // the *original* source need to be translated to local indices in
  // `currentFragment` after each split.
  let consumedLines = 0;

  // The LAST entry is the trailing page; we don't split AFTER the
  // trailing fragment. We split AFTER every entry except the last.
  for (let i = 0; i < entries.length - 1; i++) {
    const { endSegId } = entries[i]!;
    const lineIndex = parseLineIndex(endSegId);
    if (lineIndex === undefined) continue;
    // The split occurs at the line FOLLOWING endSegId — i.e. local
    // line index `(lineIndex + 1) - consumedLines` in currentFragment.
    const localSplitLine = lineIndex + 1 - consumedLines;
    const metrics = measureParagraphLines(currentFragment);
    if (localSplitLine <= 0 || localSplitLine >= metrics.length) continue;
    const rawOffset = metrics[localSplitLine]?.startCharOffset;
    if (rawOffset === undefined || rawOffset === 0) continue;
    const offset = snapToWordBoundary(currentFragment, rawOffset);
    if (offset === 0) continue;
    const tail = splitElementAtCharOffset(currentFragment, offset);
    const nextPageIdx = entries[i + 1]!.pageIdx;
    out.set(nextPageIdx, tail);
    currentFragment = tail;
    consumedLines = lineIndex + 1;
  }
  return out;
}

function parseLineIndex(segId: string): number | undefined {
  const m = /^L(\d+)$/.exec(segId);
  if (!m) return undefined;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : undefined;
}

// ─── list distribution (<ol> / <ul>) ─────────────────────────────────────

function appendListContents(
  sourceList: HTMLElement,
  lis: ReadonlyArray<HTMLElement>,
  fragmentSourceEl: HTMLElement, // ignored for list shape — provided for parity
  range: SegmentRange | undefined,
  pageElements: HTMLElement[],
  setOpen: (sourceList: HTMLElement, clone: HTMLElement) => void,
): void {
  void fragmentSourceEl;
  // Resolve the LI index slice [startIdx, endIdx] for this page.
  const { startIdx, endIdx } = resolveListRange(range, lis.length);
  if (startIdx > endIdx) return;

  // Compute the start number for ordered lists. The clone's `start`
  // attribute is the logical user-visible number of the first LI on
  // this page — equal to source `start` (default 1) + startIdx.
  const baseStart = readStartAttr(sourceList);
  const clone = cloneListContainer(sourceList, baseStart + startIdx);
  for (let i = startIdx; i <= endIdx; i++) {
    const li = lis[i];
    if (!li) continue;
    clone.appendChild(li);
  }
  pageElements.push(clone);
  setOpen(sourceList, clone);
}

function resolveListRange(
  range: SegmentRange | undefined,
  totalLis: number,
): { startIdx: number; endIdx: number } {
  // No range = whole list on this page.
  if (!range) return { startIdx: 0, endIdx: totalLis - 1 };
  const startIdx = parseListIndex(range.startSegmentId) ?? 0;
  // `endSegmentId` is the LAST LI on this page. `_END` is the
  // synthesised final-segment sentinel from engine.ts — means "to the
  // end of the list".
  const endIdx =
    range.endSegmentId === "_END"
      ? totalLis - 1
      : (parseListIndex(range.endSegmentId) ?? totalLis - 1);
  return { startIdx, endIdx };
}

function parseListIndex(segId: string): number | undefined {
  const m = /^LI(\d+)$/.exec(segId);
  if (!m) return undefined;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : undefined;
}

function cloneListContainer(source: HTMLElement, startNum: number): HTMLElement {
  const clone = document.createElement(source.tagName.toLowerCase());
  for (const attr of Array.from(source.attributes)) {
    if (attr.name === "start") continue;
    clone.setAttribute(attr.name, attr.value);
  }
  if (source.tagName === "OL") {
    clone.setAttribute("start", String(startNum));
  }
  return clone;
}

function readStartAttr(list: Element): number {
  const raw = list.getAttribute("start");
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 1;
}

// ─── table distribution (<table>) ────────────────────────────────────────

function appendTableContents(
  sourceTable: HTMLElement,
  trs: ReadonlyArray<HTMLElement>,
  range: SegmentRange | undefined,
  pageElements: HTMLElement[],
): void {
  const { startIdx, endIdx } = resolveTableRange(range, trs.length);
  if (startIdx > endIdx) return;
  const clone = cloneTableContainer(sourceTable);
  // THEAD repeats on every page clone for visual continuity. Take a
  // snapshot before we MOVE TBODY rows so subsequent page clones can
  // still find the THEAD rows in the source — but the snapshot is the
  // ELEMENT references; we deep-clone for each per-page clone instead
  // of moving so they repeat. Without cloning, only the first page's
  // clone would have a THEAD.
  appendThead(sourceTable, clone);
  const cloneTbody = clone.querySelector(":scope > tbody")!;
  for (let i = startIdx; i <= endIdx; i++) {
    const tr = trs[i];
    if (!tr) continue;
    cloneTbody.appendChild(tr);
  }
  pageElements.push(clone);
}

function resolveTableRange(
  range: SegmentRange | undefined,
  totalTrs: number,
): { startIdx: number; endIdx: number } {
  if (!range) return { startIdx: 0, endIdx: totalTrs - 1 };
  const startIdx = parseRowIndex(range.startSegmentId) ?? 0;
  const endIdx =
    range.endSegmentId === "_END"
      ? totalTrs - 1
      : (parseRowIndex(range.endSegmentId) ?? totalTrs - 1);
  return { startIdx, endIdx };
}

function parseRowIndex(segId: string): number | undefined {
  const m = /^R(\d+)$/.exec(segId);
  if (!m) return undefined;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : undefined;
}

function collectTrs(table: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const tbody = table.querySelector(":scope > tbody");
  if (tbody) {
    for (const child of Array.from(tbody.children)) {
      if (child.tagName === "TR" && child instanceof HTMLElement) out.push(child);
    }
  } else {
    for (const child of Array.from(table.children)) {
      if (child.tagName === "TR" && child instanceof HTMLElement) out.push(child);
    }
  }
  return out;
}

function cloneTableContainer(source: HTMLElement): HTMLElement {
  const clone = document.createElement("table");
  for (const attr of Array.from(source.attributes)) {
    clone.setAttribute(attr.name, attr.value);
  }
  const sourceTbody = source.querySelector(":scope > tbody");
  if (sourceTbody) {
    const tbodyClone = document.createElement("tbody");
    for (const attr of Array.from(sourceTbody.attributes)) {
      tbodyClone.setAttribute(attr.name, attr.value);
    }
    clone.appendChild(tbodyClone);
  } else {
    clone.appendChild(document.createElement("tbody"));
  }
  return clone;
}

function appendThead(sourceTable: HTMLElement, clone: HTMLElement): void {
  const sourceThead = sourceTable.querySelector(":scope > thead");
  if (!sourceThead) return;
  // Deep clone so the source thead stays available for the next
  // per-page clone.
  const theadClone = sourceThead.cloneNode(true) as HTMLElement;
  clone.insertBefore(theadClone, clone.firstChild);
}

// ─── cleanup helpers ─────────────────────────────────────────────────────

function isListContainer(el: Element): boolean {
  return el.tagName === "OL" || el.tagName === "UL";
}

function childrenByTag(parent: HTMLElement, tag: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const child of Array.from(parent.children)) {
    if (child instanceof HTMLElement && child.tagName === tag) out.push(child);
  }
  return out;
}

function removeIfEmptyTable(src: HTMLElement): void {
  const sections = Array.from(src.children).filter(
    (c) => c.tagName === "THEAD" || c.tagName === "TBODY",
  );
  const hasAnyRow =
    sections.some((s) => s.children.length > 0) ||
    (sections.length === 0 && src.children.length > 0);
  if (!hasAnyRow) src.parentElement?.removeChild(src);
}
