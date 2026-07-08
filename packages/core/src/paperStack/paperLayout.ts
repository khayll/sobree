/**
 * `sobree.paperLayout` — the typed bridge between the paper stack's
 * private page DOM and plugins.
 *
 * It answers page-layout questions plugins would otherwise answer by
 * hardcoding `.paper*` selectors: *what page cards exist?*, *which page
 * card is this element on?*, *is this element in a running header/footer?*
 * Plugins (`block-tools` positioning, `review` comment gutter) call these
 * instead of querying paperStack class names, so the stack can evolve its
 * DOM without breaking them. Read-only, except that `RenderedPaper.commentSlot`
 * is a sanctioned mount point plugins append UI into.
 *
 * Sibling to `editor.renderedDocument` (document-content identity); this
 * surface is page/paper LAYOUT. Class-name strings live in
 * `./paperClasses.ts`, the single protocol source.
 */

import {
  CLS_PAPER,
  CLS_PAPER_COMMENTS,
  CLS_PAPER_FOOTER,
  CLS_PAPER_HEADER,
  CLS_PAPER_ROW,
} from "./paperClasses";

/** A running-header or running-footer zone (the body flow is neither). */
export type PaperZone = "header" | "footer";

/** One rendered page card and its sanctioned plugin mount slots. */
export interface RenderedPaper {
  /** The page card element (`.paper`) — page geometry box, positioning
   *  anchor for floating UI. */
  readonly root: HTMLElement;
  /** The per-page right-margin gutter. Plugins append UI here (review
   *  comment cards); core keeps it as a stable mount point so the row's
   *  flex layout doesn't shift when a plugin attaches/detaches. */
  readonly commentSlot: HTMLElement;
}

/** A header/footer zone match from {@link PaperLayoutIndex.nearestZone}. */
export interface PaperZoneMatch {
  readonly zone: PaperZone;
  /** The zone container element (`.paper-header` / `.paper-footer`). */
  readonly element: HTMLElement;
}

/** The paper-layout lookup surface (`sobree.paperLayout`). */
export interface PaperLayoutIndex {
  /** Every rendered page card, in document (top-to-bottom) order. */
  papers(): RenderedPaper[];
  /** The page card element containing `target`, or `null` when `target`
   *  sits outside the paper stack. */
  nearestPaper(target: Element): HTMLElement | null;
  /** The running header/footer zone containing `target`, or `null` when
   *  `target` is in the body flow (or outside a page). */
  nearestZone(target: Element): PaperZoneMatch | null;
}

/**
 * Concrete `PaperLayoutIndex` over a live paper-stack root. `root()` is a
 * thunk (not a stored element) because the stack root is stable but this
 * keeps the bridge honest if a host ever swaps it.
 */
export class PaperLayout implements PaperLayoutIndex {
  constructor(private readonly root: () => HTMLElement) {}

  papers(): RenderedPaper[] {
    const out: RenderedPaper[] = [];
    for (const row of this.root().querySelectorAll<HTMLElement>(`.${CLS_PAPER_ROW}`)) {
      const paper = row.querySelector<HTMLElement>(`.${CLS_PAPER}`);
      const commentSlot = row.querySelector<HTMLElement>(`.${CLS_PAPER_COMMENTS}`);
      if (paper && commentSlot) out.push({ root: paper, commentSlot });
    }
    return out;
  }

  nearestPaper(target: Element): HTMLElement | null {
    const paper = target.closest<HTMLElement>(`.${CLS_PAPER}`);
    return paper && this.root().contains(paper) ? paper : null;
  }

  nearestZone(target: Element): PaperZoneMatch | null {
    const stack = this.root();
    const header = target.closest<HTMLElement>(`.${CLS_PAPER_HEADER}`);
    if (header && stack.contains(header)) return { zone: "header", element: header };
    const footer = target.closest<HTMLElement>(`.${CLS_PAPER_FOOTER}`);
    if (footer && stack.contains(footer)) return { zone: "footer", element: footer };
    return null;
  }
}
