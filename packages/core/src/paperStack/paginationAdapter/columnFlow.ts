/**
 * Multi-column section flow — equal AND unequal, across pages.
 *
 * A Word multi-column section (`<w:cols w:num="2">`, with or without
 * explicit per-column widths) flows its content in newspaper order:
 * fill column 0 to the page bottom, then column 1, then continue on the
 * NEXT page. CSS can express neither unequal column widths nor a flow
 * that fragments across our manually-paginated, fixed-height page boxes,
 * so this pass owns the whole 2-D layout: it restructures a section's
 * blocks into explicit width tracks, chunked one wrapper per page.
 *
 * The renderer (`openColumnContainerIfNeeded`) emits ONE flat
 * `.sobree-cols` wrapper per section, stamped with the geometry and a
 * stable section id (`data-pag-cid`). This pass — run after layout, when
 * heights are measurable — replaces that wrapper with a sequence of
 * page-sized wrappers (the first reused in place, the rest inserted as
 * siblings). Each is at most one page tall, so the column-agnostic
 * paginator downstream simply places each on its own page; the columns
 * "snake" because page K+1 continues page K's content.
 *
 * Fill model:
 *   - Interior pages are FILLED: column 0 packed to the page budget,
 *     then column 1, etc.
 *   - The FINAL page is BALANCED (equalised column heights), matching
 *     Word's "balance columns at section end". A section that fits one
 *     page is a single, balanced chunk — identical to the previous
 *     single-page behaviour.
 *
 * Blocks move whole (a paragraph is never split across a column or page
 * boundary); that's faithful for the templates this targets, where
 * columns break at block boundaries.
 *
 * Idempotent: the repaginate loop re-collects every block and re-runs
 * this pass each iteration. On entry we re-consolidate the per-page
 * wrappers of each section (matched by `data-pag-cid`) back into one,
 * then re-chunk — so re-running is a no-op on a settled layout.
 */

/** Minimum usable height for the section's first chunk. If the preceding
 *  content leaves less than this on the start page, the chunk would be a
 *  sliver — let the paginator bump the whole section to the next page
 *  (give it a full-page budget) instead of stranding one block. */
const MIN_FIRST_CHUNK_PX = 48;

interface ExplicitGeom {
  kind: "explicit";
  widthsMm: number[];
  gapsMm: number[];
}
interface EqualGeom {
  kind: "equal";
  count: number;
  gapMm: number;
}
type ColGeom = ExplicitGeom | EqualGeom;

function parseMmList(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => Number.parseFloat(s))
    .filter((n) => Number.isFinite(n));
}

/** Resolve a wrapper's column geometry from its stamped dataset, or
 *  `null` if it isn't a layable multi-column wrapper (< 2 columns). */
function resolveGeometry(wrapper: HTMLElement): ColGeom | null {
  const widthsMm = parseMmList(wrapper.dataset.colWidthsMm);
  if (widthsMm.length >= 2) {
    return { kind: "explicit", widthsMm, gapsMm: parseMmList(wrapper.dataset.colGapsMm) };
  }
  const count = Number.parseInt(wrapper.dataset.colCount ?? "", 10);
  if (Number.isFinite(count) && count >= 2) {
    const gapMm = Number.parseFloat(wrapper.dataset.colGapMm ?? "0");
    return { kind: "equal", count, gapMm: Number.isFinite(gapMm) ? gapMm : 0 };
  }
  return null;
}

function trackCount(geom: ColGeom): number {
  return geom.kind === "explicit" ? geom.widthsMm.length : geom.count;
}

/** Build the `count` empty column tracks for one page of a section.
 *  Equal columns use `flex:1` so the browser sizes them; unequal columns
 *  carry an explicit `width`. A right margin supplies the inter-column
 *  gap on every track but the last. */
function buildTracks(geom: ColGeom): HTMLElement[] {
  const n = trackCount(geom);
  const tracks: HTMLElement[] = [];
  for (let i = 0; i < n; i++) {
    const col = document.createElement("div");
    col.className = "sobree-col";
    if (geom.kind === "explicit") {
      col.style.flex = "0 0 auto";
      col.style.width = `${geom.widthsMm[i]}mm`;
      const gap = geom.gapsMm[i];
      if (i < n - 1 && gap !== undefined && gap > 0) col.style.marginRight = `${gap}mm`;
    } else {
      col.style.flex = "1 1 0";
      col.style.minWidth = "0";
      if (i < n - 1 && geom.gapMm > 0) col.style.marginRight = `${geom.gapMm}mm`;
    }
    tracks.push(col);
  }
  return tracks;
}

/** Re-flatten a wrapper to its blocks in document order, whether it's
 *  pristine (blocks are direct children) or already split into tracks. */
function flatBlocks(wrapper: HTMLElement): HTMLElement[] {
  const cols = wrapper.querySelectorAll<HTMLElement>(":scope > .sobree-col");
  if (cols.length === 0) {
    return Array.from(wrapper.children).filter((c): c is HTMLElement => c instanceof HTMLElement);
  }
  const out: HTMLElement[] = [];
  for (const col of cols) {
    for (const child of Array.from(col.children)) {
      if (child instanceof HTMLElement) out.push(child);
    }
  }
  return out;
}

/**
 * Collapse a section's per-page wrappers (created by a previous run of
 * this pass, matched by `data-pag-cid`) back into the FIRST wrapper of
 * each run of same-id siblings, returning the surviving lead wrappers.
 * Wrappers without an id (single-page sections that never split) pass
 * through untouched. This makes the pass idempotent: each call starts
 * from one flat wrapper per section.
 */
function consolidate(wrappers: HTMLElement[]): HTMLElement[] {
  const leads: HTMLElement[] = [];
  let i = 0;
  while (i < wrappers.length) {
    const lead = wrappers[i]!;
    const cid = lead.dataset.pagCid;
    let j = i + 1;
    if (cid) {
      const blocks = flatBlocks(lead);
      while (j < wrappers.length && wrappers[j]!.dataset.pagCid === cid) {
        blocks.push(...flatBlocks(wrappers[j]!));
        wrappers[j]!.remove();
        j++;
      }
      lead.replaceChildren(...blocks);
    }
    leads.push(lead);
    i = j;
  }
  return leads;
}

/**
 * Fill `track` from the front of `queue` until the next block would push
 * it past `budgetPx`, moving consumed blocks out of `queue`. A block
 * re-measures at the track's width automatically (its container width
 * changed). Always consumes at least one block when `force` is set, so a
 * page can never make zero progress even if a single block is taller
 * than the budget.
 */
function fillTrack(
  track: HTMLElement,
  queue: HTMLElement[],
  budgetPx: number,
  force: boolean,
): void {
  while (queue.length > 0) {
    const block = queue[0]!;
    track.appendChild(block);
    if (track.offsetHeight > budgetPx && track.childElementCount > (force ? 1 : 0)) {
      // Overshot — this block belongs to the next track/page.
      queue.unshift(block);
      track.removeChild(block);
      break;
    }
    queue.shift();
  }
}

/**
 * Move trailing blocks from `here` to the front of `next` until the two
 * are balanced — i.e. until moving one more would not lower the taller
 * of the two. `budgetPx` is a hard ceiling: while `here` exceeds it the
 * block MUST move regardless of balance. Always leaves at least one block
 * in `here`. This is the section's original single-page balance, applied
 * to the FINAL page so its columns equalise (Word balances a section's
 * last page); a single-page section is just its only page, so it stays
 * byte-identical to the pre-snaking behaviour.
 */
function balanceForward(here: HTMLElement, next: HTMLElement, budgetPx: number): void {
  while (here.childElementCount > 1) {
    const hBefore = here.offsetHeight;
    const overBudget = hBefore > budgetPx;
    if (!overBudget && hBefore <= next.offsetHeight) break;
    const moved = here.lastElementChild as HTMLElement;
    next.insertBefore(moved, next.firstChild);
    if (!overBudget && Math.max(here.offsetHeight, next.offsetHeight) >= hBefore) {
      here.appendChild(moved); // overshot — undo and stop
      break;
    }
  }
}

/** Re-balance the final page from scratch: all its blocks into track 0,
 *  then `balanceForward` pairwise under the FULL page budget. Re-deriving
 *  the split (rather than balancing the filled state) reproduces the
 *  original single-page algorithm exactly. */
function balanceLastPage(page: HTMLElement, pageHeightPx: number): void {
  const tracks = Array.from(page.querySelectorAll<HTMLElement>(":scope > .sobree-col"));
  if (tracks.length < 2) return;
  const blocks = flatBlocks(page);
  tracks[0]!.replaceChildren(...blocks);
  for (let i = 1; i < tracks.length; i++) tracks[i]!.replaceChildren();
  for (let i = 0; i < tracks.length - 1; i++)
    balanceForward(tracks[i]!, tracks[i + 1]!, pageHeightPx);
}

/** How much of the wrapper's starting page the preceding content used,
 *  measured from the already-laid-out linear flow. `% pageHeight` maps a
 *  deep offset back into its page; the result is the space remaining for
 *  the section's first chunk. */
function startSpaceUsed(wrapper: HTMLElement, root: HTMLElement, pageHeightPx: number): number {
  const top = wrapper.getBoundingClientRect().top - root.getBoundingClientRect().top;
  if (!(top > 0)) return 0;
  return top % pageHeightPx;
}

/** Lay out one (consolidated) section wrapper into per-page column
 *  chunks. Reuses `wrapper` for page 0; inserts further pages as
 *  siblings immediately after it. */
function layoutSection(wrapper: HTMLElement, root: HTMLElement, pageHeightPx: number): void {
  const geom = resolveGeometry(wrapper);
  if (!geom) return;
  const queue = flatBlocks(wrapper);
  if (queue.length === 0) return;

  const used = startSpaceUsed(wrapper, root, pageHeightPx);
  const firstBudget = pageHeightPx - used < MIN_FIRST_CHUNK_PX ? pageHeightPx : pageHeightPx - used;

  const pages: HTMLElement[] = [];
  let current = wrapper;
  let budget = firstBudget;
  while (true) {
    const tracks = buildTracks(geom);
    current.replaceChildren(...tracks);
    for (let i = 0; i < tracks.length && queue.length > 0; i++) {
      // Each track fills to the page budget; `force` on the first track
      // guarantees ≥1 block per page so a single over-tall block still
      // makes progress (no infinite loop).
      fillTrack(tracks[i]!, queue, budget, i === 0);
    }
    pages.push(current);
    if (queue.length === 0) break;
    const next = wrapper.cloneNode(false) as HTMLElement;
    current.after(next);
    current = next;
    budget = pageHeightPx;
  }

  // Balance the final page's columns (a single-page section is its only
  // page) under the full page budget.
  balanceLastPage(pages[pages.length - 1]!, pageHeightPx);
}

/**
 * Flow every multi-column section under `root` into per-page column
 * chunks. `pageHeightPx` is the page content-height budget.
 */
export function flowColumnSections(root: HTMLElement, pageHeightPx: number): void {
  const wrappers = Array.from(root.querySelectorAll<HTMLElement>(".sobree-cols"));
  for (const lead of consolidate(wrappers)) {
    layoutSection(lead, root, pageHeightPx);
  }
}
