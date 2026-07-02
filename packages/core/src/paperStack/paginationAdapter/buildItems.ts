import { measureParagraphLines } from "./paragraphLines";
import type { DomBox, DomItem } from "./types";

/**
 * Convert a flat list of top-level block elements into an Item stream for
 * the pagination engine.
 *
 * Per-block handling:
 *   - `.page-break` / `[data-page-break]` → Penalty(-Infinity) + zero-height Box
 *     (element still lands at the top of the next page for round-tripping).
 *   - `<figure>` / `.keep-together` / `[data-keep-together]` → monolithic Box
 *     (whole block moves together; doesn't split).
 *   - `<table>`, `<pre>` → monolithic Box.
 *   - h1–h6 → Box with `keepWithNext: true`.
 *   - `<p>` with ≥2 line boxes → one Box per line (shared paragraphId,
 *     first/last flags set) so widow/orphan can act per line.
 *   - Otherwise → one Box with the element's measured height.
 *
 * Inter-block glue(0) makes every inter-block position a candidate break.
 */
export function buildItems(blocks: HTMLElement[]): DomItem[] {
  const items: DomItem[] = [];
  // Track running vertical position so inter-block glue reflects the REAL
  // gap after CSS margin-collapse (not the naïve sum of margins).
  let prevBottom = 0;
  for (let i = 0; i < blocks.length; i++) {
    const el = blocks[i];
    if (!el) continue;

    // Absolute / fixed positioning takes the element out of flow. It
    // shouldn't contribute to gaps OR to `prevBottom`. Without this
    // the next in-flow block's `offsetTop` is below the previous
    // in-flow block, but `prevBottom` reflects the absolute block's
    // (much smaller) offsetTop+0, producing a negative gap that gets
    // clamped to 0 — harmless — OR an unrelated huge gap when the
    // absolute block landed elsewhere. Either way we should ignore.
    const cs = getComputedStyle(el);
    const isOutOfFlow = cs.position === "absolute" || cs.position === "fixed";

    const gapBefore = isOutOfFlow ? 0 : Math.max(0, el.offsetTop - prevBottom);
    // Forced-break ordering: the -Infinity penalty goes BEFORE the glue,
    // so the inter-block gap is charged to the NEW page. Word honours a
    // paragraph's space-before after an explicit page break (and the CSS
    // keeps the margin on `[data-page-break-before]` blocks), so the
    // page budget must account for it. For AUTOMATIC breaks the glue
    // stays where it is — trailing on the previous page — matching
    // Word's suppression of space-before at the top of the page (the
    // `.paper-content > :first-child` rule zeroes the rendered margin).
    const forcedBreak = isPageBreakMarker(el) || hasPageBreakBefore(el);
    if (forcedBreak) items.push({ type: "penalty", cost: Number.NEGATIVE_INFINITY });
    if (i > 0 || gapBefore > 0) {
      // Glue between blocks: height is the actual laid-out gap (often 0 if
      // the previous block's margin-bottom collapsed with this one's margin-top).
      items.push({ type: "glue", height: gapBefore });
    }

    if (isPageBreakMarker(el)) {
      items.push({ type: "box", height: 0, el, monolithic: true });
    } else if (isKeepTogetherGroup(el)) {
      items.push(singleBox(el, { monolithic: true }));
    } else if (el.tagName === "P") {
      items.push(...paragraphLineItems(el, ensureParagraphId(el)));
    } else if (el.tagName === "OL" || el.tagName === "UL") {
      items.push(...listItemBoxes(el, ensureListId(el)));
    } else if (el.tagName === "TABLE") {
      items.push(...tableRowBoxes(el, ensureTableId(el)));
    } else {
      items.push(singleBox(el, extraFlagsFor(el)));
    }

    // Out-of-flow elements don't move prevBottom — they don't push
    // siblings down so the next in-flow block measures its real gap
    // against the previous in-flow block.
    if (!isOutOfFlow) {
      prevBottom = el.offsetTop + el.offsetHeight;
    }
  }
  return items;
}

/**
 * Lazily assign a stable paragraph id as a data-* attribute. `splitElementAt­CharOffset`
 * copies all attributes to the new fragment, so after a split both halves
 * share this id — widow/orphan then works across the logical paragraph even
 * though the DOM holds two sibling `<p>` elements.
 */
function ensureParagraphId(el: HTMLElement): string {
  const existing = el.dataset.pagPid;
  if (existing) return existing;
  const fresh = `p${Math.random().toString(36).slice(2, 10)}`;
  el.dataset.pagPid = fresh;
  return fresh;
}

/**
 * Lazily assign a stable list id to `<ol>` / `<ul>` parents. Mirrors
 * `ensureParagraphId`: after a list is split across pages, both halves
 * carry this id so `mergeConsecutiveFragments` can rejoin them on the
 * next pagination pass.
 */
function ensureListId(el: HTMLElement): string {
  const existing = el.dataset.pagLid;
  if (existing) return existing;
  const fresh = `l${Math.random().toString(36).slice(2, 10)}`;
  el.dataset.pagLid = fresh;
  return fresh;
}

/** Lazily assign a stable table id. Mirrors `ensureListId` so split
 *  table fragments can be rejoined by `mergeConsecutiveFragments`. */
function ensureTableId(el: HTMLElement): string {
  const existing = el.dataset.pagTid;
  if (existing) return existing;
  const fresh = `t${Math.random().toString(36).slice(2, 10)}`;
  el.dataset.pagTid = fresh;
  return fresh;
}

/**
 * Emit one box per `<tr>` child of `table`. Each row becomes its own
 * monolithic box pointing at the `<tr>` element (NOT the table) so the
 * paginator can break between rows. After pagination, `distributePages`
 * rebuilds per-page `<table>` clones from whichever rows landed on
 * each page (mirrors the `<ul>` / `<li>` pattern at one level up).
 *
 * Rows are monolithic — we don't yet split a single row across pages
 * even when its cells contain multi-line content. A row taller than
 * the page budget overflows visibly; that's a known T3 gap (Word's
 * `<w:cantSplit/>` semantics are still the implicit default here).
 */
function tableRowBoxes(table: HTMLElement, tid: string): DomItem[] {
  void tid; // ensureTableId is called by the parent for the data-pag-tid stamp
  const trs: HTMLElement[] = [];
  // Walk THEAD rows first (they render at top of each per-page table
  // clone in distributePages), then TBODY rows. Without this, tables
  // with header rows (Word's `<w:tblHeader/>` → renderer's THEAD)
  // lose their header entirely after pagination.
  //
  // Use querySelectorAll, not querySelector: the iterative repaginate
  // loop can leave a table with MULTIPLE THEAD/TBODY sections (a clone's
  // section merged back beside the source's). Walking only the first of
  // each would miss the rows in the extra sections — those rows would
  // never become boxes, never get distributed, and the source table husk
  // (still holding them) would linger as an orphan at the front of the
  // first paper. Walking every section emits every row exactly once.
  for (const section of ["thead", "tbody"] as const) {
    for (const sec of table.querySelectorAll(`:scope > ${section}`)) {
      for (const child of Array.from(sec.children)) {
        if (child.tagName === "TR" && child instanceof HTMLElement) trs.push(child);
      }
    }
  }
  // Fallback: table with no THEAD/TBODY — just walk direct TR children.
  if (trs.length === 0) {
    for (const child of Array.from(table.children)) {
      if (child.tagName === "TR" && child instanceof HTMLElement) trs.push(child);
    }
  }
  if (trs.length === 0) {
    // No rows — emit one zero box pointing at the table so it survives
    // distribution (rare; mostly defensive for malformed imports).
    return [singleBox(table, { monolithic: true })];
  }
  // Estimate a page-budget threshold for the "tall row" decision. Rows
  // taller than this are split by their dominant cell's paragraphs so
  // a long Experience / Project listing in a 2-column resume table
  // can flow across pages instead of forcing a whole-row break onto
  // the next page (the pre-split behaviour added an extra page on
  // pentest-engineer.docx). The threshold is a conservative ~40% of a
  // typical Letter content area — large enough that small label rows
  // stay monolithic, small enough that the Experience row triggers a
  // split. We don't have the actual page budget in scope here so we
  // hard-code; the paginator's actual fit decisions still drive the
  // final placement.
  const TALL_ROW_THRESHOLD_PX = 360;
  const out: DomItem[] = [];
  for (let i = 0; i < trs.length; i++) {
    const tr = trs[i]!;
    const rowHeight = tr.offsetHeight;
    if (rowHeight > TALL_ROW_THRESHOLD_PX) {
      out.push(...tallRowParagraphBoxes(tr));
    } else {
      out.push(singleBox(tr, { monolithic: true }));
    }
    if (i < trs.length - 1) out.push({ type: "glue", height: 0 });
  }
  return out;
}

/**
 * For a TR that's too tall to fit on a single page, emit one box per
 * paragraph in the row's DOMINANT cell (the cell with the most
 * paragraph-like children). The dominant cell's paragraphs become
 * candidate break points; non-dominant cells (typically label
 * columns: "Experience", "Education") attach their content to the
 * row's FIRST box via `isFirstParaOfRow` so the label appears at the
 * top of the row's first occurrence.
 *
 * `distributePages` walks these boxes and routes each into the right
 * cell of a per-page TR clone. The row's overall structure preserves
 * across pages: label cell on the first fragment, content cell content
 * split by where the paginator chose to break.
 */
function tallRowParagraphBoxes(tr: HTMLElement): DomItem[] {
  const cells = Array.from(tr.children).filter(
    (c): c is HTMLElement => c.tagName === "TD" || c.tagName === "TH",
  );
  if (cells.length === 0) return [singleBox(tr, { monolithic: true })];
  // Dominant cell = the one DRIVING the row's height (tallest content),
  // not the one with the most block children. Selecting by count tied a
  // 9-item `<ul>` revision cell with the one-line date cell next to it
  // (both have a single block child), picked the date cell, and emitted
  // a 20px box for a 680px row — so the engine under-measured the row,
  // never broke the page, and the table overflowed. Height is the real
  // "which cell makes this row tall" signal.
  let dominant = cells[0]!;
  let domHeight = cellContentHeight(cells[0]!);
  for (let i = 1; i < cells.length; i++) {
    const h = cellContentHeight(cells[i]!);
    if (h > domHeight) {
      dominant = cells[i]!;
      domHeight = h;
    }
  }
  const paras = cellParagraphs(dominant);
  if (paras.length === 0) return [singleBox(tr, { monolithic: true })];

  const out: DomItem[] = [];
  const boxes: DomBox[] = [];
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i]!;
    const box: DomBox = {
      type: "box",
      height: measureBlockHeight(p),
      el: p,
      cellTr: tr,
      isFirstLineOfParagraph: true,
      isLastLineOfParagraph: true,
      ...(i === 0 ? { isFirstParaOfRow: true } : {}),
    };
    boxes.push(box);
    out.push(box);
    if (i < paras.length - 1) out.push({ type: "glue", height: 0 });
  }
  // Faithfulness invariant: the row's boxes must sum to the row's TRUE
  // rendered height, or the engine under-measures it. The dominant
  // cell's paragraph heights don't include cell padding, inter-cell
  // borders, or a non-dominant cell that's nonetheless taller than its
  // own text — so push any residual onto the last box. Over-measuring
  // is harmless (worst case the row breaks one px early); under-
  // measuring overflows the page.
  const residual = tr.offsetHeight - boxes.reduce((sum, b) => sum + b.height, 0);
  if (residual > 0) boxes[boxes.length - 1]!.height += residual;
  return out;
}

/** Total height of a cell's breakable block children — the signal for
 *  which cell drives a tall row's height. */
function cellContentHeight(cell: HTMLElement): number {
  return cellParagraphs(cell).reduce((sum, p) => sum + measureBlockHeight(p), 0);
}

/**
 * Walk a cell's BLOCK-LEVEL children (`<p>`, `<ol>`, `<ul>`). Each
 * direct child becomes one splittable unit — ULs stay intact (so the
 * bullet marker / list grouping survive the row split). Splitting
 * *within* a UL inside a cell is a smaller-grain feature; for now,
 * the whole UL travels with its preceding paragraph as one box.
 *
 * Nested tables / divs not yet handled — would need recursive walks.
 * Resume cells don't typically nest tables.
 */
function cellParagraphs(cell: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const child of Array.from(cell.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.tagName === "P" || child.tagName === "OL" || child.tagName === "UL") {
      out.push(child);
    }
  }
  return out;
}

/**
 * Emit one box per visual line, per `<li>` child.
 *
 * Each `<li>` is treated as if it were a top-level `<p>` — multi-line
 * LIs produce one box per line (via `paragraphLineItems`) so the
 * paginator can break inside an LI when it doesn't fit. After
 * pagination, `distributePages` splits the LI at the character offset
 * of the first line on the later page (same `splitElementAtCharOffset`
 * machinery <p>-splitting uses). The OL/UL is rebuilt per page from
 * the LI fragments that landed on each.
 *
 * The OL element itself has no box — its identity is preserved via
 * the `data-pag-lid` attribute (stamped here) so
 * `mergeConsecutiveFragments` rejoins split fragments before the next
 * pagination pass. Each LI gets its own `data-pag-pid` for the same
 * reason at the LI level.
 */
function listItemBoxes(list: HTMLElement, lid: string): DomItem[] {
  void lid; // ensureListId is called by the parent for the data-pag-lid stamp
  const lis = Array.from(list.children).filter((c): c is HTMLElement => c.tagName === "LI");
  if (lis.length === 0) {
    // Empty list — nothing to paginate. Emit a zero-height placeholder
    // pointing at the OL itself so it survives distribution.
    return [singleBox(list, {})];
  }
  const out: DomItem[] = [];
  for (let i = 0; i < lis.length; i++) {
    const li = lis[i]!;
    const pid = ensureParagraphId(li);
    const lineItems = paragraphLineItems(li, pid);
    out.push(...lineItems);
    if (i < lis.length - 1) {
      // Inter-item glue is the REAL laid-out gap (LI margins — Word's
      // `<w:spacing w:after>` between bullets), measured exactly like
      // the top-level block loop measures inter-block gaps. A hardcoded
      // 0 here under-counted every spaced list by ~spacing×items and
      // over-packed pages (healthcare's 17-bullet skills list measured
      // ~140px short, pushing page-1 content through the bottom margin).
      //
      // `offsetTop`/`offsetHeight` are integer-rounded, so a fractional
      // line box (18.4px) reports a phantom 1px "gap" per item. That's
      // below the measurement resolution, not real spacing — counting it
      // accumulates false fullness (~1px × bullets) and spills the last
      // line of a tightly-fitting document onto an extra page. Real
      // spacing gaps are ≥ a few px; ignore anything under 2.
      const next = lis[i + 1]!;
      const raw = next.offsetTop - (li.offsetTop + li.offsetHeight);
      out.push({ type: "glue", height: raw >= 2 ? raw : 0 });
    }
  }
  return out;
}

function paragraphLineItems(p: HTMLElement, pid: string): DomItem[] {
  const lines = measureParagraphLines(p);
  // `data-keep-next` applies to the LAST line of the paragraph so the
  // paginator forbids breaking between the paragraph and what follows
  // it. Mirrors how h1-h6 implicitly get keepWithNext via extraFlagsFor.
  const keepNext = p.hasAttribute("data-keep-next");
  // `data-keep-together` (Word's `<w:keepLines/>`) marks every line box
  // so the engine keeps the paragraph's lines on one page (whole-fit
  // check in fillPage + in-paragraph break penalty), while the paragraph
  // keeps its line-level metadata — unlike the monolithic group path.
  const keepTogether = p.hasAttribute("data-keep-together");
  if (lines.length <= 1) {
    return [
      singleBox(p, {
        paragraphId: pid,
        isFirstLineOfParagraph: true,
        isLastLineOfParagraph: true,
        ...(keepNext ? { keepWithNext: true } : {}),
        ...(keepTogether ? { keepTogether: true } : {}),
      }),
    ];
  }
  const out: DomItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const isLast = i === lines.length - 1;
    const box: DomBox = {
      type: "box",
      height: line.height,
      el: p,
      paragraphId: pid,
      isFirstLineOfParagraph: i === 0,
      isLastLineOfParagraph: isLast,
      lineIndex: i,
      totalLines: lines.length,
      ...(isLast && keepNext ? { keepWithNext: true } : {}),
      ...(keepTogether ? { keepTogether: true } : {}),
    };
    out.push(box);
    if (i < lines.length - 1) out.push({ type: "glue", height: 0 });
  }
  return out;
}

function singleBox(el: HTMLElement, extra: Partial<DomBox>): DomBox {
  return {
    type: "box",
    height: measureBlockHeight(el),
    el,
    isFirstLineOfParagraph: true,
    isLastLineOfParagraph: true,
    ...extra,
  };
}

function extraFlagsFor(el: HTMLElement): Partial<DomBox> {
  const tag = el.tagName.toLowerCase();
  const flags: Partial<DomBox> = {};
  if (/^h[1-6]$/.test(tag)) flags.keepWithNext = true;
  // Explicit AST-driven keepNext — stamped by the renderer when the
  // paragraph properties (or its resolved style cascade) say so. Matches
  // Word's `<w:keepNext/>` semantics.
  if (el.hasAttribute("data-keep-next")) flags.keepWithNext = true;
  // keepLines on a heading (`<hN>` renders as one box, so keepTogether
  // is effectively a no-op today) — recorded for consistency with the
  // paragraph-line path.
  if (el.hasAttribute("data-keep-together")) flags.keepTogether = true;
  if (tag === "pre") flags.monolithic = true;
  return flags;
}

function measureBlockHeight(el: HTMLElement): number {
  // `offsetHeight` is logical — ignoring any CSS transform scale on an
  // ancestor viewport. `getBoundingClientRect` would return post-transform
  // pixels and mismatch the logical `pageContentHeight` budget.
  const cs = getComputedStyle(el);
  // Absolute / fixed positioning takes the element out of flow — it
  // doesn't push siblings down and shouldn't consume page budget.
  // jellap.docx's lifted text-box and shape-placeholder frames are
  // both absolute; without this skip the paginator counts the
  // placeholder's 47mm height twice (once via the absolute element,
  // once via the gap to its in-flow sibling), losing ~178px from the
  // page budget and triggering a spurious extra page.
  if (cs.position === "absolute" || cs.position === "fixed") return 0;
  // Boxes are the BORDER-BOX height only. Margins are owned by the GLUE
  // items (the `offsetTop − prevBottom` deltas measured by the block
  // walk), which reflect the real laid-out gap after margin collapse.
  // The old `offsetHeight + marginTop` here predates that glue and
  // DOUBLE-COUNTED every single-line paragraph's space-before (once in
  // the glue, once in the box) — pages holding several spaced headings
  // ran a phantom ~15-25px fuller per heading and under-filled, breaking
  // a paragraph or two earlier than Word/LibreOffice on the same budget
  // (acm-submission-template page 2 carried +53px of phantom height).
  return el.offsetHeight;
}

function isPageBreakMarker(el: HTMLElement): boolean {
  return el.classList.contains("page-break") || el.hasAttribute("data-page-break");
}

/**
 * Block elements with `data-page-break-before` (set by the renderer when
 * a paragraph has `pageBreakBefore: true`) want a forced break BEFORE
 * them. We emit a Penalty(-Infinity) before the element's normal box.
 */
function hasPageBreakBefore(el: HTMLElement): boolean {
  return el.hasAttribute("data-page-break-before");
}

function isKeepTogetherGroup(el: HTMLElement): boolean {
  // Paragraph-like elements are NEVER keep-together GROUPS: their
  // `data-keep-together` (Word's `<w:keepLines/>`) is expressed as a
  // `keepTogether` flag on their line boxes instead, so the paragraph
  // KEEPS its `paragraphId` / `keepWithNext` / widow-orphan metadata.
  // Collapsing a heading to a monolithic group box here silently
  // discarded its keepNext — Word's heading styles declare keepNext
  // AND keepLines together, so every heading was affected.
  if (/^(P|H[1-6])$/.test(el.tagName)) return false;
  if (el.tagName === "FIGURE") return true;
  if (el.classList.contains("keep-together")) return true;
  if (el.hasAttribute("data-keep-together")) return true;
  return false;
}
