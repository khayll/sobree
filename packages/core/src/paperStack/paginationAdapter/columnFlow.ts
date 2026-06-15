/**
 * Unequal multi-column flow.
 *
 * CSS multi-column only produces equal columns, so a Word section with
 * explicit per-column widths (`<w:cols w:equalWidth="0">`) can't be laid
 * out by CSS. The renderer (`openColumnContainerIfNeeded`) emits a flat
 * `.sobree-cols-unequal` wrapper stamped with the column geometry; this
 * pass — run after layout, when heights are measurable — restructures it
 * into explicit-width column tracks and flows the section's blocks across
 * them.
 *
 * Fill model: BALANCE, not fill-to-page. Word balances a multi-column
 * section that has no explicit column break and fits one page — it
 * equalises the column heights rather than packing the first column to
 * the page bottom and spilling the remainder. (CSS `column-count` does
 * the same for the equal-width path; this is the unequal-width analogue.)
 * A naive "fill column 1 to the page height, then spill" instead packs
 * the wide column nearly full before the narrow one starts, and — worse —
 * the page-height threshold sits far above the actual content, so a few
 * pixels of font-metric drift between renders (web fonts loaded vs not)
 * flip blocks across the boundary. Balancing both matches Word and is
 * stable: the split lands at the block boundary that minimises the
 * tallest column, which block granularity pins in place.
 *
 * Scope: single-page column sections (a section whose content fits one
 * page), which matches the equal-column path's current capability — that
 * wraps a section's content in one monolithic block the paginator places
 * on a single page. Blocks are moved whole (a paragraph is not split
 * across a column boundary); that's faithful for the templates this
 * targets, where columns break at block boundaries. `colHeightPx` is the
 * page content height — a hard ceiling no column may exceed (content
 * taller than that genuinely overflows the page, out of this scope).
 * Idempotent: re-running re-flattens and re-fills, so the iterative
 * paginate loop can call it each pass.
 */

/** Re-flatten a wrapper to its blocks in document order, whether it's
 *  pristine (blocks are direct children) or already split into columns. */
function flatBlocks(wrapper: HTMLElement): HTMLElement[] {
  const cols = wrapper.querySelectorAll(":scope > .sobree-col");
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

function parseMmList(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => Number.parseFloat(s))
    .filter((n) => Number.isFinite(n));
}

/** Lay out one unequal-column section into width tracks and fill them. */
function layoutOne(wrapper: HTMLElement, colHeightPx: number): void {
  const widths = parseMmList(wrapper.dataset.colWidthsMm);
  if (widths.length < 2) return;
  const gaps = parseMmList(wrapper.dataset.colGapsMm);
  const blocks = flatBlocks(wrapper);

  const tracks = widths.map((w, i) => {
    const col = document.createElement("div");
    col.className = "sobree-col";
    col.style.width = `${w}mm`;
    const gap = gaps[i];
    if (i < widths.length - 1 && gap !== undefined && gap > 0) {
      col.style.marginRight = `${gap}mm`;
    }
    return col;
  });
  wrapper.replaceChildren(...tracks);

  // Fill: all blocks into track 0, then balance each track against the
  // next by moving trailing blocks forward. Moving the LAST block of a
  // track to the FRONT of the next preserves document order. A block
  // re-measures at the new track's width automatically (its container
  // width changed), so every height read is against the column the block
  // actually lives in.
  tracks[0]!.append(...blocks);
  for (let i = 0; i < tracks.length - 1; i++) {
    balanceForward(tracks[i]!, tracks[i + 1]!, colHeightPx);
  }
}

/**
 * Move trailing blocks from `here` to the front of `next` until the two
 * are balanced — i.e. until moving one more would not lower the taller
 * of the two columns. `budgetPx` is a hard ceiling: while `here` exceeds
 * it the block MUST move regardless of balance (it doesn't fit the page).
 * Always leaves at least one block in `here` so a column is never empty.
 */
function balanceForward(here: HTMLElement, next: HTMLElement, budgetPx: number): void {
  while (here.childElementCount > 1) {
    const hBefore = here.offsetHeight;
    const overBudget = hBefore > budgetPx;
    // Balanced and within budget — nothing more to move.
    if (!overBudget && hBefore <= next.offsetHeight) break;

    const moved = here.lastElementChild!;
    next.insertBefore(moved, next.firstChild);

    // A balancing move is kept only if it lowered the tallest column;
    // otherwise it overshot (the block was big enough to make `next`
    // the new tall one) — put it back and stop. Over-budget moves are
    // unconditional: `here` has to shed height to fit the page.
    if (!overBudget && Math.max(here.offsetHeight, next.offsetHeight) >= hBefore) {
      here.appendChild(moved);
      break;
    }
  }
}

/**
 * Flow every unequal-column section under `root` into its width tracks.
 * `colHeightPx` is the page content-height budget (the height each
 * column may fill before spilling to the next).
 */
export function flowUnequalColumnSections(root: HTMLElement, colHeightPx: number): void {
  const wrappers = root.querySelectorAll<HTMLElement>(".sobree-cols-unequal");
  for (const wrapper of wrappers) {
    layoutOne(wrapper, colHeightPx);
  }
}
