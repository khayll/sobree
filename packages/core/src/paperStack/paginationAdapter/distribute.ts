import type { Page } from "../../pagination/types";
import { measureParagraphLines } from "./paragraphLines";
import { snapToWordBoundary, splitElementAtCharOffset } from "./splitParagraph";
import type { DomBox } from "./types";

/**
 * Turn the paginator's `Page[]` into a per-page array of DOM elements.
 *
 * Two flavours of split:
 *
 *   - **Multi-line `<p>` straddling a page boundary**: split the `<p>`
 *     at the character offset of the first line on the later page.
 *     Original keeps the head fragment; a clone (same tag, attributes
 *     preserved, data-pag-continuation stamped) holds the tail.
 *   - **Multi-line `<li>` straddling a page boundary**: same machinery
 *     — `<li>` is treated like `<p>` by `buildItems`, so the per-line
 *     boxes route through `splitParagraphAcrossPages` too. Continuation
 *     `<li>` fragments are tagged so CSS can hide their list marker.
 *
 * On top of per-element splits, `<li>` elements need re-wrapping into
 * per-page `<ol>` / `<ul>` clones (you can't have a bare `<li>` at
 * paper-content level — its marker won't render). The third pass
 * groups consecutive same-source LIs into per-page list-container
 * clones with the right `start` attribute so numbering continues
 * across page breaks.
 */
export function distributePages(pages: Page[]): HTMLElement[][] {
  // 1. Group line boxes by their originating <p> or <li>.
  const elementPages = new Map<HTMLElement, Map<number, number>>();
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    for (const it of pages[pageIdx]!.items) {
      if (it.type !== "box") continue;
      const b = it as DomBox;
      if (b.lineIndex === undefined) continue;
      let m = elementPages.get(b.el);
      if (!m) {
        m = new Map();
        elementPages.set(b.el, m);
      }
      m.set(b.lineIndex, pageIdx);
    }
  }

  // 2. Split each multi-page element at character offsets. Generic
  //    over <p> vs <li> — splitElementAtCharOffset clones whatever
  //    tag the source element has.
  const fragments = new Map<HTMLElement, Map<number, HTMLElement>>();
  for (const [original, lineMap] of elementPages) {
    fragments.set(original, splitParagraphAcrossPages(original, lineMap));
  }

  // 2b. Mark every non-final fragment of a multi-page element with
  // `sobree-fragment-continued`. The class triggers `text-align-last:
  // justify` in CSS so the visually-last line of each non-final
  // fragment is justified rather than left-aligned — matches Word's
  // rendering of a paragraph that splits across pages (in Word the
  // last line of the *logical* paragraph stays left-aligned, but
  // intermediate fragments' last lines justify because they're a
  // middle line of the source). Visual fidelity only; doesn't change
  // the browser's line-break decisions (verified empirically).
  markContinuedFragments(fragments);

  // 3. For every source <ol> / <ul> with split LIs, compute the
  //    "logical" (user-visible) number of every LI fragment. This is
  //    the value the per-page OL clone's `start` attribute uses.
  //    Continuation fragments share the number of their head sibling.
  //    Walk done BEFORE moving any LI out of the source OL.
  const liLogicalNumber = new Map<HTMLElement, number>();
  const seenSourceLists = new Set<HTMLElement>();
  for (const [original] of fragments) {
    if (original.tagName !== "LI") continue;
    const sourceList = original.parentElement;
    if (!sourceList || !isListContainer(sourceList)) continue;
    if (seenSourceLists.has(sourceList)) continue;
    seenSourceLists.add(sourceList);
    indexLogicalNumbers(sourceList, liLogicalNumber);
  }

  // 4. Walk pages, build per-page element lists, MOVING LIs into
  //    freshly-cloned per-page OL/UL containers as we go. Track every
  //    source list we touch so cleanup (step 5) can remove the ones
  //    we emptied.
  const sourceListsTouched = new Set<HTMLElement>();
  const sourceTrsTouched = new Set<HTMLElement>();
  const result: HTMLElement[][] = [];
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const seen = new Set<HTMLElement>();
    const pageElements: HTMLElement[] = [];
    let openContainerSource: HTMLElement | null = null;
    let openContainerClone: HTMLElement | null = null;
    // Track open per-page TR clone for row-content splitting (tall rows
    // emit one box per dominant-cell paragraph; each lands in this TR
    // clone's matching cell).
    let openTrSource: HTMLElement | null = null;
    let openTrClone: HTMLElement | null = null;

    for (const it of pages[pageIdx]!.items) {
      if (it.type !== "box") continue;
      const b = it as DomBox;
      let el: HTMLElement;
      if (b.lineIndex !== undefined) {
        el = fragments.get(b.el)?.get(pageIdx) ?? b.el;
      } else {
        el = b.el;
      }
      if (seen.has(el)) continue;
      seen.add(el);

      // Row-content split: paragraph-box from a tall TR. Open / reuse
      // a per-page TR clone and route the paragraph into its matching
      // cell. The TR clone gets all source cells empty; on the FIRST
      // paragraph of the row (`isFirstParaOfRow`) we also move every
      // non-dominant cell's content into the matching cell so labels
      // appear at the top of the row's first occurrence.
      if (b.cellTr) {
        const tr = b.cellTr;
        const sourceTable = tr.closest("table") as HTMLElement | null;
        const sourceTbody = sourceTable?.querySelector(":scope > tbody") as HTMLElement | null;
        if (!sourceTable || !sourceTbody) {
          pageElements.push(el);
          openContainerSource = null;
          openContainerClone = null;
          openTrSource = null;
          openTrClone = null;
          continue;
        }
        if (sourceTable !== openContainerSource) {
          openContainerClone = cloneTableContainer(sourceTable);
          pageElements.push(openContainerClone);
          openContainerSource = sourceTable;
          sourceListsTouched.add(sourceTable);
          openTrSource = null;
          openTrClone = null;
        }
        if (tr !== openTrSource) {
          // Build a TR clone with the SAME number of empty cells as the
          // source row (preserves column structure / widths via attrs).
          openTrClone = cloneEmptyRow(tr);
          const cloneTbody = openContainerClone!.querySelector(":scope > tbody")!;
          cloneTbody.appendChild(openTrClone);
          openTrSource = tr;
          sourceTrsTouched.add(tr);
        }
        // Find which cell owns the paragraph in the source TR.
        const sourceCell = el.closest("td, th") as HTMLElement | null;
        if (!sourceCell) {
          // Defensive: paragraph isn't actually in a cell. Put it on
          // pageElements as a stand-alone block so it doesn't get lost.
          pageElements.push(el);
          continue;
        }
        const cellChildren = Array.from(tr.children) as HTMLElement[];
        const cellIdx = cellChildren.indexOf(sourceCell);
        const targetCell = openTrClone!.children[cellIdx] as HTMLElement | undefined;
        if (!targetCell) {
          pageElements.push(el);
          continue;
        }
        // For the FIRST paragraph of the row, also move every
        // non-dominant cell's content into the row clone. The label
        // cell's content lands on the first fragment only — subsequent
        // fragments have empty label cells, which is the right visual
        // semantics (label appears once at top of row).
        if (b.isFirstParaOfRow) {
          for (let i = 0; i < cellChildren.length; i++) {
            if (i === cellIdx) continue;
            const srcCell = cellChildren[i]!;
            const tgtCell = openTrClone!.children[i] as HTMLElement;
            while (srcCell.firstChild) tgtCell.appendChild(srcCell.firstChild);
          }
        }
        targetCell.appendChild(el);
        continue;
      }
      if (el.tagName === "LI") {
        const sourceList = el.parentElement;
        if (!sourceList || !isListContainer(sourceList)) {
          pageElements.push(el);
          openContainerSource = null;
          openContainerClone = null;
          continue;
        }

        if (sourceList !== openContainerSource) {
          const startNum = liLogicalNumber.get(el) ?? readStartAttr(sourceList);
          openContainerClone = cloneListContainer(sourceList, startNum);
          pageElements.push(openContainerClone);
          openContainerSource = sourceList;
          sourceListsTouched.add(sourceList);
        }

        // Continuation LIs (those carrying the data-pag-continuation
        // stamp from splitElementAtCharOffset) get a class so CSS can
        // hide their marker. Heads keep their default marker.
        if (el.dataset.pagContinuation === "1") {
          el.classList.add("sobree-li-continuation");
        } else {
          el.classList.remove("sobree-li-continuation");
        }

        openContainerClone!.appendChild(el);
      } else if (el.tagName === "TR" && !b.cellTr) {
        // Table rows go into per-page `<table><tbody>` clones, mirroring
        // the LI → OL/UL pattern. Without this, a `<table>` that doesn't
        // fit on one page either lands wholly on the next page (when
        // smaller than one page) or overflows visibly (when larger),
        // hiding most of the resume body. Splitting by row lets the
        // table flow naturally across pages.
        const sourceSection = el.parentElement;
        const sourceTable = sourceSection?.closest("table") as HTMLElement | null;
        if (!sourceTable) {
          pageElements.push(el);
          openContainerSource = null;
          openContainerClone = null;
          continue;
        }

        if (sourceTable !== openContainerSource) {
          openContainerClone = cloneTableContainer(sourceTable);
          pageElements.push(openContainerClone);
          openContainerSource = sourceTable;
          sourceListsTouched.add(sourceTable);
        }

        // Route THEAD-sourced TRs to the clone's THEAD; TBODY-sourced
        // TRs (the common case) to the clone's TBODY. The clone always
        // has a TBODY; THEAD is created on demand when first needed.
        const isHeader = sourceSection?.tagName === "THEAD";
        let target: Element;
        if (isHeader) {
          let cloneThead = openContainerClone!.querySelector(":scope > thead");
          if (!cloneThead) {
            cloneThead = document.createElement("thead");
            openContainerClone!.insertBefore(cloneThead, openContainerClone!.firstChild);
          }
          target = cloneThead;
        } else {
          target = openContainerClone!.querySelector(":scope > tbody") ?? openContainerClone!;
        }
        target.appendChild(el);
      } else {
        pageElements.push(el);
        openContainerSource = null;
        openContainerClone = null;
      }
    }

    result.push(pageElements);
  }

  // 5. Cleanup: source OL / UL / TABLE elements whose LIs / TRs all
  //    got moved into per-page clones are left empty (or with an
  //    empty TBODY in the TABLE case). Remove them — they're no
  //    longer part of any page's content. `mergeConsecutiveFragments`
  //    would absorb them on the next pass anyway, but cleaning up
  //    here keeps the post-distribute DOM tidy and keeps
  //    measurement-time inspection from picking up ghosts.
  // Empty source TRs first (row-content split moved all cell content
  // to per-page clones). Must precede source-list / source-table
  // cleanup so the now-empty source table is correctly detected.
  for (const tr of sourceTrsTouched) {
    const allEmpty = Array.from(tr.children).every((cell) =>
      cell.tagName !== "TD" && cell.tagName !== "TH"
        ? true
        : cell.children.length === 0 && (cell.textContent ?? "").trim() === "",
    );
    if (allEmpty && tr.parentElement) {
      tr.parentElement.removeChild(tr);
    }
  }
  for (const source of sourceListsTouched) {
    if (source.tagName === "TABLE") {
      // Table is "empty" iff every THEAD and TBODY contains no rows.
      const sections = Array.from(source.children).filter(
        (c) => c.tagName === "THEAD" || c.tagName === "TBODY",
      );
      const hasAnyRow =
        sections.some((s) => s.children.length > 0) ||
        (sections.length === 0 && source.children.length > 0);
      if (!hasAnyRow && source.parentElement) {
        source.parentElement.removeChild(source);
      }
    } else if (source.children.length === 0 && source.parentElement) {
      source.parentElement.removeChild(source);
    }
  }

  return result;
}

// ---------- helpers ----------

/**
 * Add `sobree-fragment-continued` to every fragment that has a *later*
 * sibling fragment of the same logical element. The class drives
 * `text-align-last: justify` — matches Word, which justifies the
 * last line of intermediate fragments (the actual-last-line-of-source
 * left-aligns as normal).
 */
function markContinuedFragments(fragments: Map<HTMLElement, Map<number, HTMLElement>>): void {
  for (const [, pageMap] of fragments) {
    const orderedPages = Array.from(pageMap.keys()).sort((a, b) => a - b);
    // Every fragment except the one on the highest page is "continued".
    for (let i = 0; i < orderedPages.length - 1; i++) {
      const frag = pageMap.get(orderedPages[i]!);
      if (frag) frag.classList.add("sobree-fragment-continued");
    }
  }
}

function isListContainer(el: Element): boolean {
  return el.tagName === "OL" || el.tagName === "UL";
}

/**
 * Clone a `<table>` (and its single `<tbody>`) for a per-page split.
 * Preserves attributes (data-block-id, data-section-index, class,
 * style, …) and `data-pag-tid` so `mergeConsecutiveFragments` can
 * rejoin the split table on the next pagination pass. The clone
 * starts with an empty TBODY; rows are appended in the distribute
 * walk.
 *
 * THEAD / COLGROUP would need to be cloned wholesale (not stripped)
 * so per-page tables retain column widths + repeating headers. Not yet
 * exercised by the corpus — when a fixture demands it, copy them here
 * in source order before the empty TBODY.
 */
/**
 * Clone a `<tr>` with empty cells preserving structure. Each TD / TH
 * is cloned shallow (attributes only, no children) — paragraph boxes
 * from `tallRowParagraphBoxes` will append into the matching cell.
 * Used for row-content splitting where a single source TR's content
 * flows across multiple per-page TR clones.
 */
function cloneEmptyRow(source: HTMLElement): HTMLElement {
  const trClone = document.createElement("tr");
  for (const attr of Array.from(source.attributes)) {
    trClone.setAttribute(attr.name, attr.value);
  }
  for (const cell of Array.from(source.children)) {
    if (cell.tagName !== "TD" && cell.tagName !== "TH") continue;
    const cellClone = document.createElement(cell.tagName.toLowerCase());
    for (const attr of Array.from(cell.attributes)) {
      cellClone.setAttribute(attr.name, attr.value);
    }
    trClone.appendChild(cellClone);
  }
  return trClone;
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
    // Source lacked an explicit tbody (rare; browsers usually add one).
    // Still emit one in the clone so row appends land in valid HTML.
    clone.appendChild(document.createElement("tbody"));
  }
  return clone;
}

function readStartAttr(list: Element): number {
  const raw = list.getAttribute("start");
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 1;
}

/**
 * Walk the source OL / UL's LI children and assign each a "logical
 * number" — the user-visible number that LI would carry in the
 * un-paginated source list. Continuation fragments (sharing
 * `data-pag-pid` with their preceding sibling) get the SAME number as
 * the head; new heads bump the counter.
 */
function indexLogicalNumbers(sourceList: HTMLElement, out: Map<HTMLElement, number>): void {
  let logical = readStartAttr(sourceList);
  let lastPid: string | undefined;
  let firstSeen = false;
  for (const child of Array.from(sourceList.children)) {
    if (child.tagName !== "LI") continue;
    const li = child as HTMLElement;
    const pid = li.dataset.pagPid;
    if (firstSeen) {
      if (!pid || pid !== lastPid) logical += 1;
    } else {
      firstSeen = true;
    }
    out.set(li, logical);
    lastPid = pid;
  }
}

/**
 * Make a per-page clone of an OL / UL. Copies all attributes except
 * `start` (which we override with `startNum` so numbering continues
 * across page breaks). The clone shares `data-pag-lid` with the
 * source so `mergeConsecutiveFragments` can rejoin them on the next
 * pagination pass.
 */
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

/**
 * If `original` spans multiple pages, split the element at each
 * boundary. Returns a map: pageIdx → fragment element on that page.
 *
 * Generic over `<p>` and `<li>` — both are split via
 * `splitElementAtCharOffset` which clones whichever tag the source
 * has. Continuation fragments carry `data-pag-continuation="1"`
 * (stamped by `splitElementAtCharOffset`) so the LI continuation
 * styling fires for list items but not for paragraphs.
 */
function splitParagraphAcrossPages(
  original: HTMLElement,
  lineMap: Map<number, number>,
): Map<number, HTMLElement> {
  const orderedLines = Array.from(lineMap.keys()).sort((a, b) => a - b);
  const result = new Map<number, HTMLElement>();

  // Find lines at which the page changes; these are split points.
  const splitLines: number[] = [];
  let prevPage = lineMap.get(orderedLines[0]!)!;
  for (let i = 1; i < orderedLines.length; i++) {
    const line = orderedLines[i]!;
    const page = lineMap.get(line)!;
    if (page !== prevPage) splitLines.push(line);
    prevPage = page;
  }

  result.set(lineMap.get(orderedLines[0]!)!, original);
  if (splitLines.length === 0) return result;

  // Perform splits in order. After each split, subsequent splits
  // operate on the new tail element (which still contains all later
  // lines).
  let currentFragment = original;
  let currentFragmentStartLine = 0;
  for (const splitLine of splitLines) {
    const localLine = splitLine - currentFragmentStartLine;
    const metrics = measureParagraphLines(currentFragment);
    const rawOffset = metrics[localLine]?.startCharOffset;
    if (rawOffset === undefined || rawOffset === 0) continue;
    // Never split a word — snap backward to the nearest whitespace.
    // If there isn't one (very long single token), skip this split
    // and let the page overflow rather than break the word.
    const offset = snapToWordBoundary(currentFragment, rawOffset);
    if (offset === 0) continue;
    const tail = splitElementAtCharOffset(currentFragment, offset);
    result.set(lineMap.get(splitLine)!, tail);
    currentFragment = tail;
    currentFragmentStartLine = splitLine;
  }

  return result;
}
