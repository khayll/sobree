import "./paperStack.css";
import type {
  AnchoredFrame,
  Block,
  NamedStyle,
  NumberingDefinition,
  SectionProperties,
} from "../doc/types";
import type { AnchorLayerContext } from "../editor/view/docRenderer/anchorLayer";
import { renderBlocks } from "../editor/view/docRenderer/block";
import { restoreSelection, saveSelection } from "../util/selection";
import { distributeFootnotes, footnotePageHeights } from "./footnoteFlow";
import {
  type PageSetup,
  resolvedDimensions,
  substituteVariables,
  zoneTemplateFor,
} from "./pageSetup";
import { paginateBlocks } from "./paginationAdapter";
import { flowColumnSections } from "./paginationAdapter/columnFlow";
import { Paper } from "./paper";

/**
 * Sourced from `SobreeDocument`: the rich AST + the dependencies
 * `renderBlocks` needs (numbering, named styles, embedded media bytes).
 * When set, every page renders headers/footers from this AST and
 * ignores the `PageSetup.header.default` / `footer.default` string
 * templates. Cleared (set back to `null`) when the doc has no
 * header/footer parts — falls back to the legacy text path.
 */
export interface RichZonesSource {
  headerFooterBodies: Record<string, Block[]>;
  /** Floating frames per header/footer part, keyed by the same partId as
   *  `headerFooterBodies`. Absent for docs whose zones have no floats. */
  headerFooterFrames?: Record<string, AnchoredFrame[]>;
  numbering: readonly NumberingDefinition[];
  styles: readonly NamedStyle[];
  rawParts: Record<string, Uint8Array>;
}

const MM_TO_PX = 96 / 25.4;

/** Cap on iterative repagination retries. Each iteration shrinks the
 *  budget by the observed overflow, so convergence is exponential —
 *  3 is plenty for any realistic doc and prevents accidental infinite
 *  loops on pathological content. */
const MAX_REPAGINATE_RETRIES = 3;

/** "Is this page actually overflowing enough to warrant a re-pack?"
 *  Set to ~one body line — sub-line overflows are visually
 *  imperceptible and re-paginating to fix them tends to shift page
 *  breaks by a full line elsewhere, drifting AWAY from Word/LibreOffice
 *  break points rather than toward them. We only iterate when the
 *  overflow exceeds a typical line height. (~28px ≈ 21pt at 12pt
 *  body — covers the common case where split-slippage adds a line.) */
const OVERFLOW_TOLERANCE_PX = 28;

/**
 * Stack of Paper elements. The stack's root is the single contentEditable
 * region; each paper's header/footer is contentEditable=false. Blocks of
 * editor content are physically distributed across the papers'
 * `.paper-content` elements. Editing naturally crosses page boundaries
 * because the whole stack is one editable region.
 *
 * Call `repaginate()` after content changes or after page setup changes.
 */
export class PaperStack {
  readonly root: HTMLElement;
  private papers: Paper[] = [];
  private setup: PageSetup;
  /**
   * Layout-side zoom tier currently applied to an ancestor (via the Viewport's
   * CSS `zoom`). Measurements from offsetHeight/offsetTop come back in zoomed
   * pixels, so the page budget must scale the same way.
   */
  private renderTier = 1;
  /** Optional observer fired after every successful repagination. */
  private paginateListeners: Set<(pageCount: number) => void> = new Set();
  /**
   * Per-section property overrides. When set, each Paper applies the
   * section's settings (currently just `vAlign`) based on the
   * `data-section-index` stamped on its first block. Sobree provides
   * this from the live document; absent → all pages use `setup`.
   */
  private sections: SectionProperties[] | null = null;
  /**
   * Optional rich-AST source for header/footer rendering. When present,
   * each paper's header/footer is rendered from the matching part body
   * (resolved through `sections[i].headerRefs` / `footerRefs`) instead
   * of from the `PageSetup` string template. Set via `setRichZones`.
   */
  private richZones: RichZonesSource | null = null;
  /**
   * Document's floating-layer frames (the new architecture replacing
   * the lifter + framePictures hacks). When set, each paper is painted
   * with the subset of frames whose anchor resolves to that page;
   * paper.setAnchoredFrames does the per-page filtering and DOM swap.
   * `null` → no floating layer at all (skeleton state during Phase B).
   */
  private anchoredFrames: AnchoredFrame[] | null = null;
  /** Reused blob-URL cache across renders so the same image isn't re-uploaded. */
  private readonly anchorPictureUrlCache = new Map<string, string>();

  constructor(container: HTMLElement, setup: PageSetup) {
    this.setup = setup;
    this.root = document.createElement("div");
    this.root.className = "paper-stack";
    container.appendChild(this.root);
    this.ensurePaperCount(1);
    this.renderAllZones();
  }

  /**
   * Provide the document's sections for per-page property application.
   * Re-applied immediately so a setSections call without a content
   * change still updates papers (e.g. user edits a section's vAlign in
   * the future Page Setup section selector).
   */
  setSections(sections: readonly SectionProperties[]): void {
    this.sections = sections.slice();
    this.applyPerSectionSettings();
  }

  /**
   * Install or clear the rich AST source for header/footer rendering.
   * Re-renders zones immediately so the swap is visible without waiting
   * for the next paginate. Pass `null` to revert to the legacy text-
   * template path (no rich body available).
   */
  setRichZones(source: RichZonesSource | null): void {
    this.richZones = source;
    this.renderAllZones();
  }

  /**
   * Install or clear the document's floating-layer frames. Each frame's
   * `anchor.paragraphIndex` (when set) decides which page receives it
   * after the next repaginate; frames without a paragraph index land
   * on the first page of their section. Pass `null` to clear.
   *
   * Call after `setRichZones`/`updateBodyBlocks` so the next render
   * picks up the new floating content alongside body flow.
   */
  setAnchoredFrames(frames: readonly AnchoredFrame[] | null): void {
    this.anchoredFrames = frames ? frames.slice() : null;
    this.paintAnchorLayers();
  }

  getSetup(): PageSetup {
    return this.setup;
  }

  getPageCount(): number {
    return this.papers.length;
  }

  onPaginate(cb: (pageCount: number) => void): () => void {
    this.paginateListeners.add(cb);
    return () => this.paginateListeners.delete(cb);
  }

  /** First paper's content — initial render target for a new editor. */
  get primaryContent(): HTMLElement {
    const p = this.papers[0];
    if (!p) throw new Error("PaperStack has no papers");
    return p.content;
  }

  /** First paper card — for viewport fit-to-page calculations. */
  get firstPaper(): HTMLElement {
    const p = this.papers[0];
    if (!p) throw new Error("PaperStack has no papers");
    return p.root;
  }

  /** First paper's row wrapper (paper + comments sidebar) — for fit-to-width. */
  get firstPaperRow(): HTMLElement {
    const p = this.papers[0];
    if (!p) throw new Error("PaperStack has no papers");
    return p.outer;
  }

  /** All content hosts in document order — for serialization. */
  get contentHosts(): HTMLElement[] {
    return this.papers.map((p) => p.content);
  }

  updateSetup(setup: PageSetup): void {
    this.setup = setup;
    for (const p of this.papers) p.applySetup(setup);
    this.repaginate();
  }

  /**
   * Called by the Viewport when the layout-zoom tier changes. In Chromium,
   * CSS `zoom` doesn't change `offsetHeight`/`offsetTop`, so measurements
   * stay logical and the page budget is unaffected. We still re-paginate
   * defensively — tier changes re-render text at a new resolution, which
   * can nudge line wrapping at sub-pixel boundaries.
   */
  setRenderTier(tier: number): void {
    if (tier === this.renderTier) return;
    this.renderTier = tier;
    this.repaginate();
  }

  /**
   * Redistribute blocks across papers so no paper overflows. Creates or
   * removes papers as needed.
   *
   * Delegates to the pure paginator in `src/pagination/` via the DOM
   * adapter. Before paginating, blocks are **consolidated** into the first
   * paper's content so their `offsetTop` values share one coordinate system,
   * and consecutive `<p>` fragments sharing a `data-pag-pid` (previous-split
   * siblings of the same logical paragraph) are **merged** back into a
   * single paragraph — so each repagination starts from the clean logical
   * flow instead of accumulating inter-fragment margins.
   */
  repaginate(): void {
    const initialBlocks = this.collectAllBlocks();

    if (initialBlocks.length === 0) {
      this.ensurePaperCount(1);
      this.renderAllZones();
      this.emitPaginate();
      return;
    }

    const saved = saveSelection();
    const baselineBudgetPx = this.pageContentHeightPx();
    // Iterative paginate with per-page budget. The paginator gets a
    // `pageHeights[]` array — entry `i` is page `i`'s budget after
    // subtracting whatever space its footnote zone occupies. Pages
    // without footnotes use the full baseline budget. Each iteration:
    //
    //   1. paginate body with current `pageHeights`
    //   2. distribute footnotes — populates per-page zones based on
    //      where the refs landed
    //   3. rebuild `pageHeights` from observed footnote zone heights
    //   4. if any page's body now overflows its new (smaller) budget,
    //      retry with the updated array
    //
    // Bounded by `MAX_REPAGINATE_RETRIES`; each iteration is exponential
    // so 3 is plenty for any realistic doc.
    let pageHeights: number[] = [];
    for (let attempt = 0; attempt <= MAX_REPAGINATE_RETRIES; attempt++) {
      this.runPaginationOnce(baselineBudgetPx, pageHeights);
      distributeFootnotes(this.papers);
      const newHeights = footnotePageHeights(this.papers, baselineBudgetPx);
      const stable = arraysEqual(newHeights, pageHeights);
      pageHeights = newHeights;
      // Stable + no overflow → done. Stable + overflow shouldn't
      // happen (the shrunken budget already reserved footnote space),
      // but guard with the existing overflow check anyway.
      const overflowPx = this.maxPaperOverflowPx();
      if (stable && overflowPx <= OVERFLOW_TOLERANCE_PX) break;
    }

    restoreSelection(saved);
    this.renderAllZones();
    this.applyPerSectionSettings();
    this.emitPaginate();
  }

  /**
   * One round of consolidate → merge → paginate → distribute.
   * Re-entrant: each call re-collects blocks from every paper, so the
   * iterative loop in `repaginate` can call this multiple times with
   * shrinking budgets to absorb post-split slippage.
   */
  private runPaginationOnce(budgetPx: number, pageHeights: readonly number[] = []): void {
    const blocks = this.collectAllBlocks();
    const firstContent = this.papers[0]!.content;
    for (const block of blocks) {
      if (block.parentElement !== firstContent) firstContent.appendChild(block);
    }
    mergeConsecutiveFragments(firstContent);
    // Multi-column sections (equal and unequal) are flowed into explicit
    // per-page column tracks now that the body is laid out and heights are
    // measurable. Each page-chunk is a sub-page-height wrapper, so the
    // column-agnostic paginator below simply places each on its own page;
    // content snakes across pages between chunks.
    flowColumnSections(firstContent, budgetPx);
    const consolidatedBlocks = Array.from(firstContent.children).filter(
      (c): c is HTMLElement => c instanceof HTMLElement,
    );

    const rawPages = paginateBlocks(
      consolidatedBlocks,
      budgetPx,
      pageHeights.length > 0 ? pageHeights : undefined,
    );
    // Trailing-empty absorption: if the last page contains only
    // visually-empty blocks (empty paragraphs, no images, no tables),
    // sweep them onto the previous page. Matches Word's / LibreOffice's
    // behaviour for trailing whitespace — they keep blank tail
    // paragraphs anchored to the prior page rather than spawning a
    // dedicated page. Without this, jellap.docx ends with a 3rd page
    // containing two empty paragraphs.
    const pages = collapseTrailingEmptyPages(rawPages);
    // Note: there is no post-pagination "underfilled page" absorption.
    // Widow/orphan handling lives in the engine's break-cost function
    // (`pagination/cost.ts`), not a post-process pass — a post-pass here
    // would have to re-measure blocks while they're still stacked in
    // `firstContent`, where tables / frames report a fraction of their
    // distributed height and get misclassified as widows.
    const pageCount = Math.max(1, pages.length);
    this.ensurePaperCount(pageCount);

    // `distributePages` may insert NEW per-page list clones at
    // specific positions in `pageBlocks` (between H1 and the existing
    // P/H1 siblings that came from `renderBlocks`). Those existing
    // siblings are already children of `firstContent` from the pre-
    // pagination consolidation pass. If we only re-parent blocks that
    // currently live in a different paper, the new clones get
    // `appendChild`-ed at the END of `target.content` and the existing
    // siblings keep their old position — yielding all H1/P first, then
    // all UL clones at the bottom (observed on google-modern.docx: 4
    // section headings cluster above 4 bullet lists). Always call
    // `appendChild` per block in `pageBlocks` order: same-parent calls
    // MOVE the node to the end of the parent's child list, so iterating
    // pageBlocks lays them down in exactly the order the paginator
    // intended. Out-of-flow (`position: absolute|fixed`) elements skip
    // the move — re-parenting under a transformed paper could disturb
    // their resolved positioning ancestor (jellap.docx's anchored
    // textbox frames depend on staying under their original paragraph).
    for (let i = 0; i < pageCount; i++) {
      const target = this.papers[i];
      const pageBlocks = pages[i];
      if (!target || !pageBlocks) continue;
      for (const block of pageBlocks) {
        const pos = getComputedStyle(block).position;
        if (pos === "absolute" || pos === "fixed") {
          if (block.parentElement !== target.content) {
            target.content.appendChild(block);
          }
          continue;
        }
        target.content.appendChild(block);
      }
    }
  }

  /**
   * Build a `pageHeights[]` array from observed footnote-zone heights.
   * Entry `i` = `baselineBudgetPx - footnoteZoneHeight(i)`. Pages
   * without footnotes get the full baseline. Returned array trims
   * trailing entries equal to the baseline, so consumers can detect
   * "no per-page overrides needed" via `length === 0`.
   */

  /**
   * Largest content overflow across all papers, in CSS px. Zero means
   * every paper fits within its content area. Used by the iterative
   * `repaginate` to detect post-split slippage that needs another
   * pagination pass with a tighter budget.
   */
  private maxPaperOverflowPx(): number {
    const budget = this.pageContentHeightPx();
    let max = 0;
    for (const paper of this.papers) {
      const blocks = Array.from(paper.content.children);
      const last = blocks[blocks.length - 1] as HTMLElement | undefined;
      if (!last) continue;
      const used = last.offsetTop + last.offsetHeight;
      // Footnote zone (when non-empty) sits absolutely positioned just
      // above the footer area, stealing visual space from the body
      // budget. Comments now live in a sidebar OUTSIDE the paper, so
      // they don't compete with body — only footnotes need budget
      // reservation here.
      const footnoteH = paper.footnotes.classList.contains("is-empty")
        ? 0
        : paper.footnotes.offsetHeight;
      const effectiveBudget = budget - footnoteH;
      const overflow = used - effectiveBudget;
      if (overflow > max) max = overflow;
    }
    return max;
  }

  /**
   * For every Paper, look at its first content block's `data-section-index`
   * and apply that section's overrides. Falls back silently when no
   * sections were provided or a paper is empty.
   */
  private applyPerSectionSettings(): void {
    if (!this.sections) return;
    for (const paper of this.papers) {
      const first = paper.content.firstElementChild as HTMLElement | null;
      const raw = first?.dataset.sectionIndex;
      const idx = raw === undefined ? 0 : Number(raw);
      const section = this.sections[idx] ?? this.sections[0];
      if (section) paper.applySectionOverride(section);
    }
  }

  private emitPaginate(): void {
    const count = this.getPageCount();
    for (const cb of this.paginateListeners) {
      try {
        cb(count);
      } catch (err) {
        console.error("[sobree] paginate listener threw:", err);
      }
    }
  }

  destroy(): void {
    this.paginateListeners.clear();
    for (const p of this.papers) p.destroy();
    this.papers = [];
    this.root.remove();
  }

  private pageContentHeightPx(): number {
    // Prefer the EFFECTIVE content area height — what the first paper's
    // `.paper-content` element actually reports after CSS layout. The
    // `Paper.applyZoneOverflowPadding` may have bumped the paper's
    // padding-top above `setup.margins.top` to make room for a
    // taller-than-margin rich header (jellap.docx pushes body down by
    // ~50mm because its header has logo + lifted contact-info textbox).
    // If we ignored this and used the raw margin-derived budget, the
    // paginator would think the page is ~200px taller than visible,
    // overpack page 1, and the user would silently lose content past
    // the bottom edge (Word's "Rendelkezik-e" and "Igényelnek-e"
    // questions vanished without trace).
    const firstPaper = this.papers[0];
    if (firstPaper) {
      const contentHeightPx = firstPaper.content.offsetHeight;
      if (contentHeightPx > 0) return contentHeightPx;
    }
    const { heightMM } = resolvedDimensions(this.setup);
    const { top, bottom } = this.setup.margins;
    // CSS `zoom` on an ancestor changes `getBoundingClientRect` but NOT
    // `offsetHeight`/`offsetTop` (in Chromium). Since the adapter measures
    // blocks via `offsetHeight`, measurements stay in logical space at any
    // render tier — so the budget stays logical too.
    return (heightMM - top - bottom) * MM_TO_PX;
  }

  private collectAllBlocks(): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const p of this.papers) {
      for (const child of Array.from(p.content.children)) {
        if (child instanceof HTMLElement) out.push(child);
      }
    }
    return out;
  }

  private ensurePaperCount(n: number): void {
    while (this.papers.length < n) {
      this.papers.push(new Paper(this.root, this.setup));
    }
    while (this.papers.length > n) {
      const p = this.papers.pop();
      p?.destroy();
    }
  }

  private renderAllZones(): void {
    const pages = this.papers.length;
    const richZones = this.richZones;
    const ctx = richZones ? this.anchorLayerCtx(richZones) : null;
    this.papers.forEach((paper, i) => {
      const pageNum = i + 1;
      const sectionIdx = this.sectionIndexForPage(i);
      const isFirstOfSection = this.isFirstPaperOfSection(i, sectionIdx);
      const header = this.pickRichZone("header", sectionIdx, isFirstOfSection);
      const footer = this.pickRichZone("footer", sectionIdx, isFirstOfSection);

      if (richZones && ctx && header !== null) {
        paper.setHeaderBlocks({
          blocks: header.body,
          numbering: richZones.numbering,
          styles: richZones.styles,
          rawParts: richZones.rawParts,
          pageNumber: pageNum,
          totalPages: pages,
        });
        // A zone is flow + floats: paint the same part's anchored frames
        // into the header overlay. The same partId resolves on every
        // page that uses this header, and each paint builds independent
        // DOM, so a repeating header paints on every page with no cloning.
        paper.setHeaderFrames(richZones.headerFooterFrames?.[header.partId] ?? [], ctx);
      } else {
        const hTpl = zoneTemplateFor(this.setup.header, pageNum, pages);
        paper.setHeaderText(substituteVariables(hTpl, { page: pageNum, pages }));
        paper.setHeaderFrames([], this.emptyAnchorCtx());
      }

      if (richZones && ctx && footer !== null) {
        paper.setFooterBlocks({
          blocks: footer.body,
          numbering: richZones.numbering,
          styles: richZones.styles,
          rawParts: richZones.rawParts,
          pageNumber: pageNum,
          totalPages: pages,
        });
        paper.setFooterFrames(richZones.headerFooterFrames?.[footer.partId] ?? [], ctx);
      } else {
        const fTpl = zoneTemplateFor(this.setup.footer, pageNum, pages);
        paper.setFooterText(substituteVariables(fTpl, { page: pageNum, pages }));
        paper.setFooterFrames([], this.emptyAnchorCtx());
      }
    });
    // Repaint floating layer alongside zones so a setRichZones (or
    // setSections) call that triggers renderAllZones also refreshes
    // anchor placement.
    this.paintAnchorLayers();
  }

  /**
   * Build the `AnchorLayerContext` shared by body + zone overlays. The
   * injected `renderBody` routes textbox bodies through the full
   * `renderBlocks` pipeline so anchored text matches body formatting,
   * keeping `anchorLayer` decoupled from `block.ts`.
   */
  private anchorLayerCtx(richZones: RichZonesSource): AnchorLayerContext {
    return {
      rawParts: richZones.rawParts,
      pictureUrlCache: this.anchorPictureUrlCache,
      renderBody: (blocks: Block[], host: HTMLElement) => {
        renderBlocks(blocks, host, richZones.numbering, richZones.styles, richZones.rawParts);
      },
      // Textbox frames are editable islands unless the stack is in read
      // mode (`is-read-mode` is toggled by `Sobree.setMode`). Read off the
      // root at paint time so a mode switch + repaint flips it.
      editable: !this.root.classList.contains("is-read-mode"),
    };
  }

  /** Context for clearing an overlay to empty (no rich zones to draw). */
  private emptyAnchorCtx(): AnchorLayerContext {
    return { rawParts: {}, pictureUrlCache: this.anchorPictureUrlCache };
  }

  /**
   * Filter the document's `anchoredFrames` per paper and ask each Paper
   * to swap its anchor-layer DOM accordingly. A frame's destination
   * page is determined by its anchor:
   *   - `paragraphIndex` set → page that ended up containing that
   *     body block (looked up by `data-block-index` stamped on
   *     rendered children).
   *   - paragraphIndex absent → first paper of the frame's section.
   *
   * Cheap and idempotent; safe to call after any layout change.
   */
  private paintAnchorLayers(): void {
    const frames = this.anchoredFrames;
    if (!this.richZones || frames === null) {
      // No floating layer wanted — clear every paper's overlay.
      for (const p of this.papers) p.setAnchoredFrames([], this.emptyAnchorCtx());
      return;
    }
    const ctx = this.anchorLayerCtx(this.richZones);
    // Build per-page assignment. A paragraph-anchored frame lives on
    // the page whose .paper-content contains an element stamped with
    // `data-block-index="N"` where N === paragraphIndex. Anything
    // else falls onto the first page of its section (currently always
    // section 0 — multi-section frame routing is a follow-up).
    // Assign each frame to a PAGE only — the per-frame origin resolution
    // (`relativeFrom` → absolute position, including the anchor paragraph's
    // rendered Y) happens in `Paper.setAnchoredFrames`, which can see the
    // laid-out content. Here we just route a paragraph-anchored frame to
    // the page whose `.paper-content` holds its `data-block-index`.
    const perPage: AnchoredFrame[][] = this.papers.map(() => []);
    const paragraphIndex = this.buildParagraphIndex();
    for (const frame of frames) {
      let page = 0;
      if (frame.anchor.paragraphIndex !== undefined) {
        const found = paragraphIndex.get(frame.anchor.paragraphIndex);
        if (found !== undefined) page = found.page;
      }
      const bucket = perPage[page];
      if (bucket) bucket.push(frame);
    }
    for (let i = 0; i < this.papers.length; i++) {
      this.papers[i]!.setAnchoredFrames(perPage[i] ?? [], ctx);
    }
  }

  /**
   * Walk every paper's content children once and record, for each
   * `data-block-index="N"` element, the paper index that holds it.
   * The renderer stamps that attribute when emitting body paragraphs;
   * this is the only piece of mutual knowledge between body flow and
   * the floating layer needed for paragraph anchoring.
   */
  private buildParagraphIndex(): Map<number, { page: number; el: HTMLElement }> {
    const out = new Map<number, { page: number; el: HTMLElement }>();
    for (let i = 0; i < this.papers.length; i++) {
      const stamped = this.papers[i]!.content.querySelectorAll<HTMLElement>("[data-block-index]");
      for (const el of Array.from(stamped)) {
        const n = Number(el.dataset.blockIndex);
        if (Number.isFinite(n) && !out.has(n)) out.set(n, { page: i, el });
      }
    }
    return out;
  }

  /**
   * Section index a paper belongs to. Read off the first content
   * block's `data-section-index` (stamped by `renderBlocks`). Empty
   * papers and the no-sections case fall back to 0.
   */
  private sectionIndexForPage(paperIdx: number): number {
    const paper = this.papers[paperIdx];
    if (!paper) return 0;
    const first = paper.content.firstElementChild as HTMLElement | null;
    const raw = first?.dataset.sectionIndex;
    if (raw === undefined) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * True when this paper is the first page of its section. Used to
   * select the `first`-typed header/footer ref when the section has
   * `titlePage = true`.
   */
  private isFirstPaperOfSection(paperIdx: number, sectionIdx: number): boolean {
    if (paperIdx === 0) return true;
    return this.sectionIndexForPage(paperIdx - 1) !== sectionIdx;
  }

  /**
   * Resolve which header/footer Block[] applies to a paper. Walks the
   * section's refs by type and looks up the corresponding part body in
   * `richZones.headerFooterBodies`. Returns `null` when no rich body
   * applies (no refs, or `richZones` not set).
   */
  private pickRichZone(
    kind: "header" | "footer",
    sectionIdx: number,
    isFirstOfSection: boolean,
  ): { partId: string; body: readonly Block[] } | null {
    if (!this.richZones || !this.sections) return null;
    // OOXML §17.10.3: when a section omits headerReference / footerReference,
    // the corresponding zone is inherited from the prior section. Walk back
    // until we find a section that declares refs; bail at section 0. This
    // is how multi-section forms (jellap.docx) keep a single header part
    // across continuous section breaks even though only section 0 names it.
    let lookupIdx = sectionIdx;
    let section: SectionProperties | undefined;
    while (lookupIdx >= 0) {
      const candidate = this.sections[lookupIdx];
      if (candidate) {
        const refs = kind === "header" ? candidate.headerRefs : candidate.footerRefs;
        if (refs.length > 0) {
          section = candidate;
          break;
        }
      }
      lookupIdx -= 1;
    }
    if (!section) return null;
    const refs = kind === "header" ? section.headerRefs : section.footerRefs;
    if (refs.length === 0) return null;
    // Type preference: titlePage + first-of-section → `first`,
    // otherwise → `default`. Even-page support is a future addition.
    const preferred =
      isFirstOfSection && section.titlePage === true
        ? (refs.find((r) => r.type === "first") ?? refs.find((r) => r.type === "default"))
        : (refs.find((r) => r.type === "default") ?? refs[0]);
    if (!preferred) return null;
    const body = this.richZones.headerFooterBodies[preferred.partId];
    if (body === undefined) return null;
    return { partId: preferred.partId, body };
  }
}

/**
 * Walk `container`'s direct children and merge adjacent fragments back
 * into their logical parents:
 *
 *   - `<p>` siblings sharing a `data-pag-pid` rejoin into one paragraph.
 *   - `<ol>` / `<ul>` siblings sharing a `data-pag-lid` rejoin into one
 *     list — the head's `start` attribute is preserved, the tail's is
 *     dropped, and the tail's `<li>` children move into the head.
 *   - INSIDE every merged list, sibling `<li>` fragments sharing a
 *     `data-pag-pid` rejoin too — the post-paragraph-split repair
 *     applied to LIs since they're now treated like paragraphs by
 *     the paginator.
 *
 * Continuation markers (`data-pag-continuation`, `sobree-li-continuation`
 * class) are stripped on merge so the rejoined LI starts fresh. Without
 * this, every repagination pass would accumulate stale fragments and
 * marker-suppression flags.
 */
function mergeConsecutiveFragments(container: HTMLElement): void {
  // Pass 1: merge top-level <p> and <ol>/<ul>.
  let child = container.firstElementChild as HTMLElement | null;
  while (child) {
    const next = child.nextElementSibling as HTMLElement | null;
    if (next && canMergeFragments(child, next)) {
      mergeInto(child, next);
      next.remove();
      // `child` may merge with further siblings too — stay put.
      continue;
    }
    child = next;
  }
  // Pass 2: walk into each list and merge its LI children. This
  // happens AFTER pass 1 so all LIs are back inside one OL / UL
  // before we try to merge them.
  for (const list of Array.from(container.children)) {
    if (list.tagName !== "OL" && list.tagName !== "UL") continue;
    mergeListItemFragments(list as HTMLElement);
  }
  // Pass 3: merge TBODY contents of joined tables. After pass 1
  // joined adjacent `<table>` fragments sharing `data-pag-tid`, their
  // TBODY's now-sibling rows are already in correct order — but the
  // head TABLE may have ended up with two TBODY children (head's own
  // + the moved-in tail TBODY). Collapse those into one.
  for (const table of Array.from(container.children)) {
    if (table.tagName !== "TABLE") continue;
    mergeTableBodyFragments(table as HTMLElement);
  }
}

function canMergeFragments(a: HTMLElement, b: HTMLElement): boolean {
  if (a.tagName !== b.tagName) return false;
  if (a.tagName === "P") {
    return !!a.dataset.pagPid && a.dataset.pagPid === b.dataset.pagPid;
  }
  if (a.tagName === "OL" || a.tagName === "UL") {
    return !!a.dataset.pagLid && a.dataset.pagLid === b.dataset.pagLid;
  }
  if (a.tagName === "TABLE") {
    return !!a.dataset.pagTid && a.dataset.pagTid === b.dataset.pagTid;
  }
  return false;
}

/**
 * Collapse multiple TBODY children of one `<table>` into a single
 * TBODY (head's own + every following TBODY's TRs append into the
 * head's TBODY). Side-effect of merging two table fragments via
 * `mergeInto` — it dumps the tail's entire child list (one TBODY)
 * into the head, leaving the head with two consecutive TBODY's. The
 * browser tolerates that but it confuses the next pagination pass:
 * `tableRowBoxes` only walks the FIRST TBODY's TRs.
 */
function mergeTableBodyFragments(table: HTMLElement): void {
  const tbodies = Array.from(table.children).filter((c): c is HTMLElement => c.tagName === "TBODY");
  if (tbodies.length <= 1) return;
  const head = tbodies[0]!;
  for (let i = 1; i < tbodies.length; i++) {
    const tail = tbodies[i]!;
    while (tail.firstChild) head.appendChild(tail.firstChild);
    tail.remove();
  }
}

/**
 * Merge sibling `<li>` fragments inside a list. Two adjacent LIs sharing
 * a `data-pag-pid` collapse into one; the tail's children move into the
 * head, the tail is removed.
 */
function mergeListItemFragments(list: HTMLElement): void {
  let child = list.firstElementChild as HTMLElement | null;
  while (child) {
    const next = child.nextElementSibling as HTMLElement | null;
    if (
      next &&
      child.tagName === "LI" &&
      next.tagName === "LI" &&
      child.dataset.pagPid &&
      child.dataset.pagPid === next.dataset.pagPid
    ) {
      mergeInto(child, next);
      next.remove();
      continue;
    }
    child = next;
  }
}

/**
 * Move all of `tail`'s children into `head` (preserving order) and
 * strip continuation markers from `head` so the merged element looks
 * like a fresh paragraph / LI to the next pagination pass.
 */
function mergeInto(head: HTMLElement, tail: HTMLElement): void {
  while (tail.firstChild) head.appendChild(tail.firstChild);
  // Continuation flags belong to the tail, not the merged whole.
  delete head.dataset.pagContinuation;
  head.classList.remove("sobree-li-continuation");
}

/** Parse "sobree-footnote-7" → 7; returns null for anything else. */

/**
 * Walk the paginator's output back-to-front, collapsing trailing pages
 * whose blocks are all visually empty into the previous page.
 *
 * "Visually empty" = an empty paragraph: a `<p>` (or list-item `<li>`)
 * with no text content and no embedded image / table / break. We keep
 * the empty blocks (round-trip fidelity demands every paragraph mark
 * stays in the AST) — we just stop reserving a fresh page for them.
 *
 * Stops collapsing the moment a page contains any non-empty block, so
 * a real "last page with just a signature line" still gets its own
 * page. Idempotent; safe to call on a single-page result.
 */
export function collapseTrailingEmptyPages(pages: readonly HTMLElement[][]): HTMLElement[][] {
  const out: HTMLElement[][] = pages.map((page) => page.slice());
  // Walk from the last page back. While the last page is fully empty
  // and we have a previous page to absorb into, merge it down.
  while (out.length >= 2) {
    const last = out[out.length - 1];
    if (!last || !last.every(isVisuallyEmptyBlock)) break;
    const prev = out[out.length - 2]!;
    prev.push(...last);
    out.pop();
  }
  // Now collapse MIDDLE pages whose ONLY blocks are visually empty —
  // these are pages created by stale page-break hints landing AFTER
  // empty placeholder paragraphs. LO collapses them; Sobree should
  // too. complex-multipage.docx has 2 such pages (intentional
  // `<w:br type="page"/>` followed by empty paragraphs); without
  // this collapse pass we'd render 18 pages instead of LO's 16.
  for (let i = out.length - 2; i >= 0; i--) {
    const page = out[i]!;
    if (page.length === 0) continue;
    if (!page.every(isVisuallyEmptyBlock)) continue;
    // All blocks visually empty. Push them onto the next page's
    // start so document order is preserved, then drop this page.
    const next = out[i + 1];
    if (!next) continue;
    next.unshift(...page);
    out.splice(i, 1);
  }
  return out;
}

function isVisuallyEmptyBlock(el: HTMLElement): boolean {
  const tag = el.tagName;
  // Only collapse paragraph / list-item blocks. Tables, drawings,
  // section breaks etc. always justify a page even when "empty".
  if (
    tag !== "P" &&
    tag !== "LI" &&
    tag !== "H1" &&
    tag !== "H2" &&
    tag !== "H3" &&
    tag !== "H4" &&
    tag !== "H5" &&
    tag !== "H6"
  ) {
    return false;
  }
  // Any text content (after trim) means non-empty.
  if ((el.textContent ?? "").trim().length > 0) return false;
  // Embedded images / tables / SVG / drawings keep it non-empty. We
  // include both raw graphic tags AND Sobree's drawing wrappers
  // (section-frame banners, anchored shapes) so a paragraph that's
  // textually empty but carries a poster-sized background drawing
  // — like the project pages of complex-multipage.docx where each
  // "Project:" page is a textbox-only layout — never gets absorbed.
  if (
    el.querySelector(
      "img, svg, table, canvas, iframe, video, [class*='sobree-section-frame'], [data-sobree-drawing]",
    ) !== null
  ) {
    return false;
  }
  return true;
}

function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
