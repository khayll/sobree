/**
 * Unequal multi-column flow.
 *
 * CSS multi-column only produces equal columns, so a Word section with
 * explicit per-column widths (`<w:cols w:equalWidth="0">`) can't be laid
 * out by CSS. The renderer (`openColumnContainerIfNeeded`) emits a flat
 * `.sobree-cols-unequal` wrapper stamped with the column geometry; this
 * pass — run after layout, when heights are measurable — restructures it
 * into explicit-width column tracks and flows the section's blocks across
 * them: fill column 1 to the page height, spill the overflow into column
 * 2, and so on.
 *
 * Scope: single-page column sections (a section whose content fits one
 * page), which matches the equal-column path's current capability — that
 * wraps a section's content in one monolithic block the paginator places
 * on a single page. Blocks are moved whole (a paragraph is not split
 * across a column boundary); that's faithful for the templates this
 * targets, where columns break at block boundaries. The `colHeightPx`
 * budget is the page content height. Idempotent: re-running re-flattens
 * and re-fills, so the iterative paginate loop can call it each pass.
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

  // Fill: all blocks into track 0, then spill the overflow forward one
  // block at a time. Moving the LAST block of a full track to the FRONT
  // of the next preserves document order. A block re-measures at the new
  // track's width automatically (its container width changed), so the
  // height check is always against the column the block actually lives in.
  tracks[0]!.append(...blocks);
  for (let i = 0; i < tracks.length - 1; i++) {
    const here = tracks[i]!;
    const next = tracks[i + 1]!;
    while (here.offsetHeight > colHeightPx && here.childElementCount > 1) {
      next.insertBefore(here.lastElementChild!, next.firstChild);
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
