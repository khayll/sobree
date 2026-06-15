/**
 * Footnote flow: place each footnote body on the page that references it,
 * and reserve that page's body budget for the footnote zone height.
 *
 * Split out of `PaperStack` (which owns the pagination loop) because
 * footnote placement is a distinct concern — it runs once per pagination
 * pass over the already-distributed papers, reading refs and writing the
 * per-paper `.paper-footnotes` zones, and never touches the paginator's
 * box/glue/penalty machinery.
 */

import type { Paper } from "./paper";

function footnoteIdFromAttr(attr: string): number | null {
  const m = /^sobree-footnote-(\d+)$/.exec(attr);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * For each paper, find the footnote refs that landed on it after
 * pagination and populate that paper's `.paper-footnotes` zone with the
 * cited bodies — Word's "footnote bodies render at the bottom of the page
 * where they're referenced" behaviour.
 *
 * Footnote bodies are sourced from two places:
 *   1. The doc-end `<aside class="sobree-footnotes">` the renderer
 *      initially appends to paper[0].content. We harvest the `<li>`s out
 *      of it before the aside itself gets re-paginated as a block.
 *   2. Any footnote zones already populated from a previous repaginate
 *      pass — those bodies stay in scope across iterations.
 *
 * Caveat: body budget is NOT reduced here for footnote-zone height; that
 * reservation is `footnotePageHeights`'s job, fed back into the next
 * pagination pass.
 */
export function distributeFootnotes(papers: readonly Paper[]): void {
  // 1. Harvest existing footnote bodies (from any source) into a
  //    Map<id, HTMLElement>. Bodies are cloned on each insertion so a
  //    footnote referenced from multiple pages renders multiple times
  //    without DOM ownership conflicts.
  const bodies = new Map<number, HTMLElement>();
  for (const p of papers) {
    for (const li of Array.from(p.footnotes.querySelectorAll("li[id^='sobree-footnote-']"))) {
      const id = footnoteIdFromAttr(li.id);
      if (id !== null) bodies.set(id, li as HTMLElement);
    }
    p.footnotes.replaceChildren();
    p.footnotes.classList.add("is-empty");
  }
  // Also harvest from any doc-end `<aside>` left over from the renderer.
  // The paginator treats it as a regular block, so it may have landed on
  // any page — scan them all.
  for (const p of papers) {
    for (const aside of Array.from(p.content.querySelectorAll("aside.sobree-footnotes"))) {
      for (const li of Array.from(aside.querySelectorAll("li[id^='sobree-footnote-']"))) {
        const id = footnoteIdFromAttr(li.id);
        if (id !== null) bodies.set(id, li as HTMLElement);
      }
      aside.remove();
    }
  }
  if (bodies.size === 0) return;

  // 2. For each paper, collect referenced ids in document order then
  //    populate the footnote zone.
  for (const paper of papers) {
    const refs = paper.content.querySelectorAll("[id^='sobree-footnote-ref-']");
    if (refs.length === 0) continue;
    const seen = new Set<number>();
    const list = document.createElement("ol");
    list.className = "sobree-footnotes__list";
    for (const ref of Array.from(refs)) {
      const id = footnoteIdFromAttr(
        (ref as HTMLElement).id.replace("sobree-footnote-ref-", "sobree-footnote-"),
      );
      if (id === null || seen.has(id)) continue;
      seen.add(id);
      const source = bodies.get(id);
      if (!source) continue;
      const clone = source.cloneNode(true) as HTMLElement;
      // Per-paper id keeps the anchor link working when the same footnote
      // pins to multiple pages: only the first occurrence owns the id.
      if (paper.footnotes.querySelector(`#${clone.id}`)) clone.removeAttribute("id");
      list.appendChild(clone);
    }
    if (list.children.length > 0) {
      paper.footnotes.appendChild(list);
      paper.footnotes.classList.remove("is-empty");
    }
  }
}

/**
 * Per-page body budget after subtracting each page's footnote-zone
 * height — entry `i` is page `i`'s budget. Trailing entries equal to the
 * baseline are trimmed so two arrays differing only by an unrelated tail
 * compare equal (keeps the repaginate loop's `arraysEqual` honest).
 */
export function footnotePageHeights(papers: readonly Paper[], baselineBudgetPx: number): number[] {
  const heights: number[] = [];
  for (const paper of papers) {
    // Only footnotes share the page with body content; comments live in a
    // sidebar outside the paper card.
    const fnH = paper.footnotes.classList.contains("is-empty") ? 0 : paper.footnotes.offsetHeight;
    heights.push(baselineBudgetPx - fnH);
  }
  while (heights.length > 0 && heights[heights.length - 1] === baselineBudgetPx) {
    heights.pop();
  }
  return heights;
}
