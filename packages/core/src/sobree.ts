import { pageSetupToSection, sectionToPageSetup } from "./doc/pageSetupBridge";
import type { SectionProperties, SobreeDocument } from "./doc/types";
import { exportDocx } from "./docx/export/index";
import { importDocx } from "./docx/import/index";
import { Editor, type OutlineItem, type TrackChangesState } from "./editor";
import { DEFAULT_PAGE_SETUP, type PageSetup } from "./paperStack/pageSetup";
import { type AnchorRenderDeps, PaperStack } from "./paperStack/paperStack";
import { attachSections } from "./plugins/sections";
import { mountVersionBadge } from "./versionBadge";

export type SobreeMode = "edit" | "read";

export type SobreeEvent =
  | "change"
  | "paginate"
  | "setup"
  | "mode-change"
  | "track-changes-change"
  | "docx:import"
  | "docx:export";
export interface SobreeEventPayload {
  change: {
    doc: SobreeDocument;
    /** @deprecated Use `doc`. Alias kept for backwards compatibility. */
    document: SobreeDocument;
    revision: number;
  };
  paginate: { pageCount: number };
  setup: { setup: PageSetup };
  "mode-change": { mode: SobreeMode };
  /**
   * Fires when track-changes mode flips on/off or the author changes.
   * Re-emitted from the underlying editor — `Sobree.setTrackChanges`
   * delegates to `editor.setTrackChanges`, so listeners on either
   * surface see the same events.
   */
  "track-changes-change": TrackChangesState;
  "docx:import": { warnings: string[] };
  "docx:export": { warnings: string[] };
}
export type SobreeUnsubscribe = () => void;

export interface SobreeOptions {
  /** Initial document AST. */
  initialDocument?: SobreeDocument;
  /** Page setup. Falls back to `DEFAULT_PAGE_SETUP`. */
  pageSetup?: PageSetup;
  /** Forwarded to the underlying Editor. */
  changeDebounceMs?: number;
  /**
   * Y.Doc backing the document. Forwarded to the Editor — see
   * `EditorOptions.ydoc` for the contract. Use this when you want to
   * attach a provider (`y-websocket`, `y-indexeddb`, `y-webrtc`) for
   * persistence or collaboration. If absent, the editor creates one
   * internally (still observable via `sobree.editor.ydoc`).
   */
  ydoc?: import("yjs").Doc;
  /**
   * Optional content-hashed `BlobStore` for binary parts. Forwarded
   * to the Editor — see `EditorOptions.blobStore`.
   */
  blobStore?: import("./blob").BlobStore;
  /**
   * Initial track-changes mode. Forwarded to the editor — see
   * `TrackChangesState`. When omitted, the editor starts in
   * direct-edit mode and embedders flip it later with
   * `sobree.setTrackChanges(...)`.
   */
  trackChanges?: TrackChangesState;
  /**
   * Show a small, non-interactive `@sobree/core` version badge at the
   * bottom-centre of the screen. Off by default. A debug aid for
   * confirming which renderer build is live (e.g. past a stale cache
   * after a deploy) — it has no other behaviour.
   */
  versionBadge?: boolean;
  /**
   * Show hidden text (`<w:vanish/>`) from the start. Off by default
   * (print-faithful). Toggle later with `editor.setShowHiddenText`.
   */
  showHiddenText?: boolean;
  // Plugins are no longer wired through Sobree directly — `createSobree()`
  // owns the pluggable surface and threads the editor + viewport + host
  // into each plugin's `setup(ctx)`. Direct `Sobree` users can still mount
  // plugins manually after construction by calling their `setup({...})`.
}

/**
 * Top-level embeddable product surface. Composes a framework-free `Editor`
 * with a paginated `PaperStack`, exposing a single wire-ready API for
 * hosting webapps, headless Y peers (HeadlessSobree), and agents.
 *
 * Everything on this class is JSON-clean: plain data in, plain data out.
 * No DOM nodes, Ranges, or function handles cross the public surface.
 */
export class Sobree {
  readonly editor: Editor;
  private readonly stack: PaperStack;
  private setup: PageSetup;
  private mode: SobreeMode = "edit";
  /** Guards a single in-flight `document.fonts.ready` repagination so
   *  repeated triggers while fonts load coalesce into one re-run. */
  private fontSettleScheduled = false;
  /** Removes the version badge (when `versionBadge` is on). `null` otherwise. */
  private versionBadgeTeardown: (() => void) | null = null;
  private readonly listeners: {
    change: Set<(p: SobreeEventPayload["change"]) => void>;
    paginate: Set<(p: SobreeEventPayload["paginate"]) => void>;
    setup: Set<(p: SobreeEventPayload["setup"]) => void>;
    "mode-change": Set<(p: SobreeEventPayload["mode-change"]) => void>;
    "track-changes-change": Set<(p: SobreeEventPayload["track-changes-change"]) => void>;
    "docx:import": Set<(p: SobreeEventPayload["docx:import"]) => void>;
    "docx:export": Set<(p: SobreeEventPayload["docx:export"]) => void>;
  } = {
    change: new Set(),
    paginate: new Set(),
    setup: new Set(),
    "mode-change": new Set(),
    "track-changes-change": new Set(),
    "docx:import": new Set(),
    "docx:export": new Set(),
  };
  private readonly detachPaginate: () => void;
  private readonly detachChange: () => void;
  private readonly detachTrackChanges: () => void;
  /** Detachers for default + user-provided plugins, run in reverse on
   *  `destroy` so attach order is mirrored on teardown. */
  private readonly pluginDetachers: (() => void)[] = [];

  constructor(container: HTMLElement, options: SobreeOptions = {}) {
    this.setup = options.pageSetup ?? deriveSetupFromDocument(options.initialDocument);
    this.stack = new PaperStack(container, this.setup);
    const editorOpts: ConstructorParameters<typeof Editor>[1] = {
      contentHosts: () => this.stack.contentHosts,
    };
    if (options.initialDocument) editorOpts.initialDocument = options.initialDocument;
    if (options.changeDebounceMs !== undefined)
      editorOpts.changeDebounceMs = options.changeDebounceMs;
    if (options.ydoc) editorOpts.ydoc = options.ydoc;
    if (options.blobStore) editorOpts.blobStore = options.blobStore;
    if (options.showHiddenText) editorOpts.showHiddenText = true;
    if (options.trackChanges) editorOpts.trackChanges = options.trackChanges;
    this.editor = new Editor(this.stack.root, editorOpts);

    // Mount the always-on `attachSections` plugin internally —
    // `section.insertBreakAfter` drives the section-break popover
    // and Cmd+Shift+Enter, so it ships with every Sobree mount.
    // User-supplied plugins are not handled here; `createSobree()`
    // owns the pluggable surface and threads them in with a richer
    // PluginContext (editor + viewport + host + sobree).
    this.pluginDetachers.push(attachSections(this.editor));

    // Optional renderer-version badge (debug aid, off by default).
    if (options.versionBadge) this.versionBadgeTeardown = mountVersionBadge();

    // Seed the stack with the initial document's sections so the very
    // first pagination applies per-section vAlign correctly. Subsequent
    // changes refresh sections through the `change` listener below.
    this.syncStackSections();
    // Re-derive `setup` from doc.sections[0] in case the doc was
    // pre-hydrated (e.g. from IndexedDB) before Sobree existed — the
    // change-event-driven sync below only fires on subsequent edits.
    this.syncSetupFromDocument();
    // Initial pagination. Without this, a doc that was already loaded
    // into the editor (via Y.Doc hydration, pre-seeded `initialDocument`,
    // or any path that didn't fire a `change` after Sobree subscribed)
    // would sit unpaginated — all blocks dumped into paper 0 — until
    // the user typed something. Defer one rAF so the host has laid out
    // the paper element and `offsetHeight` measurements are valid.
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(() => this.paginateUnlessZoneEditing());
    }

    this.detachChange = this.editor.on("change", (payload) => {
      // Re-derive `setup` from doc.sections[0] when they diverge — this
      // is the path that makes undo/redo of page-setup edits visually
      // revert the paper. Without it, Y.UndoManager reverses the AST
      // but the renderer keeps using the post-edit `setup`.
      // A live keystroke inside a floating textbox frame changes only that
      // frame's prose, already in its DOM and persisted to the AST/Y.Doc by
      // the editor's frame read-back. Nothing structural moved, and
      // re-pushing the doc to the stack would repaint the overlay and blow
      // away the caret mid-typing — so skip the stack sync for it. Every
      // other change (body edit, API mutation, undo/redo, remote) is
      // AST-driven: the overlay is stale and MUST repaint, even if a frame
      // happens to be focused. The editor tags the former via `liveFrameEdit`.
      if (!payload.liveFrameEdit) {
        this.syncSetupFromDocument();
        // Keep the stack's per-section overrides in sync. AST sections may
        // have shifted (insert/delete of section breaks, edits to section
        // properties); pull the latest so per-page vAlign stays correct.
        this.syncStackSections();
        // Don't repaginate while a header/footer zone is being edited in place.
        this.paginateUnlessZoneEditing();
      }
      for (const cb of this.listeners.change) {
        try {
          cb(payload);
        } catch (err) {
          console.error("[sobree] change listener threw:", err);
        }
      }
    });
    this.detachPaginate = this.stack.onPaginate((pageCount) => {
      for (const cb of this.listeners.paginate) {
        try {
          cb({ pageCount });
        } catch (err) {
          console.error("[sobree] paginate listener threw:", err);
        }
      }
    });
    // Re-emit the editor's track-changes-change so listeners attached
    // to the façade see it without having to reach `sobree.editor.on`.
    this.detachTrackChanges = this.editor.on("track-changes-change", (state) => {
      for (const cb of this.listeners["track-changes-change"]) {
        try {
          cb(state);
        } catch (err) {
          console.error("[sobree] track-changes-change listener threw:", err);
        }
      }
    });
  }

  // === access to the paper stack, for code that still needs it ===

  /** Internal stack element — useful for attaching context tools / viewport. */
  get stackRoot(): HTMLElement {
    return this.stack.root;
  }

  /** First paper element — useful as a viewport fit target on first layout. */
  get firstPaper(): HTMLElement {
    return this.stack.firstPaper;
  }

  /**
   * First paper's outer ROW (paper card + per-page comments sidebar).
   * Use as `fitWidthTarget` so the viewport's fit-to-width scales to
   * include the sidebar — fitting just `.paper` would leave the
   * sidebar clipped by the viewport's overflow.
   */
  get firstPaperRow(): HTMLElement {
    return this.stack.firstPaperRow;
  }

  /** @deprecated Inert in practice — Viewport's render tier is
   *  permanently 1 and `onRenderTierChange` never fires (layout-side
   *  zoom tiers are retired; zoom never changes layout). Retained so
   *  existing wiring compiles. */
  setRenderTier(tier: number): void {
    this.stack.setRenderTier(tier);
  }

  // === wire-ready API surface ===

  /** Current page setup for section 0 (JSON-clean). */
  getPageSetup(): PageSetup {
    return structuredClone(this.setup);
  }

  /** Number of sections in the current document. Always >= 1. */
  getSectionCount(): number {
    return Math.max(1, this.editor.getDocument().sections.length);
  }

  /**
   * Read section `index` projected onto the demo's `PageSetup` shape so
   * the same Page Setup modal can edit any section. Section 0 returns
   * the live `setup`; other sections are projected from the AST.
   *
   * Lossy for properties the bridge doesn't carry (e.g. per-section
   * pages-per-column will surface here as default), but enough for the
   * fields the modal exposes today.
   */
  getSectionSetup(index: number): PageSetup {
    if (index === 0) return this.getPageSetup();
    const section = this.editor.getDocument().sections[index];
    if (!section) return this.getPageSetup();
    const partial = sectionToPageSetup(section, this.editor.getDocument().headerFooterBodies);
    return { ...structuredClone(DEFAULT_PAGE_SETUP), ...partial };
  }

  /**
   * Write back to section `index`. Section 0 funnels through
   * `setPageSetup` (the canonical path); section 1+ goes through the
   * editor's `setDocument` so it round-trips and triggers the change
   * pipeline (repagination, listeners).
   */
  setSectionSetup(index: number, partial: Partial<PageSetup>): void {
    if (index === 0) {
      this.setPageSetup(partial);
      return;
    }
    const doc = this.editor.getDocument();
    if (index < 0 || index >= doc.sections.length) return;
    const current = this.getSectionSetup(index);
    const merged: PageSetup = { ...current, ...partial };
    const { section, headerFooterBodies } = pageSetupToSection(merged);
    const sections = doc.sections.slice();
    sections[index] = section;
    const nextDoc = {
      ...doc,
      sections,
      headerFooterBodies: { ...doc.headerFooterBodies, ...headerFooterBodies },
    };
    this.editor.setDocument(nextDoc);
  }

  /**
   * Merge `partial` into the current page setup. Triggers repagination and
   * fires `setup` event. Plain-data argument — safe over the wire.
   */
  setPageSetup(partial: Partial<PageSetup>): void {
    this.setup = { ...this.setup, ...partial };
    this.stack.updateSetup(this.setup);
    // setup represents section[0]; per-section overrides need refreshing
    // so vAlign / titlePage / etc. picked from the modal land on papers.
    this.syncStackSections();
    // Mirror section[0] back into the editor's document AST. Without
    // this, getDocument() / Y providers / setSectionSetup readers see
    // stale section properties — only `exportDocx()` overlays setup at
    // serialize time. The change ripples through `editor.setDocument`,
    // which fires a `change` event and re-runs `syncStackSections` (a
    // cheap no-op now that the doc + setup agree).
    this.writeSetupToSection0();
    for (const cb of this.listeners.setup) {
      try {
        cb({ setup: this.getPageSetup() });
      } catch (err) {
        console.error("[sobree] setup listener threw:", err);
      }
    }
  }

  /** Project the current `setup` into `doc.sections[0]` and commit. */
  private writeSetupToSection0(): void {
    const doc = this.editor.getDocument();
    const { section, headerFooterBodies } = pageSetupToSection(this.setup);
    // No-op if section[0] already matches (avoids change-event churn
    // when setPageSetup is called with the same values).
    const current = doc.sections[0];
    if (current && sameSection(current, section)) return;
    const sections = doc.sections.slice();
    sections[0] = section;
    this.editor.setDocument({
      ...doc,
      sections,
      headerFooterBodies: { ...doc.headerFooterBodies, ...headerFooterBodies },
    });
  }

  /** Current rendered page count. */
  getPageCount(): number {
    return this.stack.getPageCount();
  }

  /**
   * Force a repagination. Normally unnecessary — repagination runs after
   * every `change` event. Useful for hosts that need to ensure pagination
   * after initial mount (layout must be applied first — call from a
   * `requestAnimationFrame` after the container is in the DOM).
   */
  repaginate(): void {
    this.stack.repaginate();
  }

  /**
   * Repaginate, unless a header/footer zone is being edited in place
   * (live zone edits manage their own reflow). Also schedules a re-run
   * once any still-loading document fonts settle.
   */
  private paginateUnlessZoneEditing(): void {
    if (this.stack.root.classList.contains("is-zone-editing")) return;
    // Live frame keystrokes never reach here — the change handler skips the
    // whole stack sync for them (`liveFrameEdit`). Everything that does
    // reach here is AST-driven and repaginates normally.
    this.stack.repaginate();
    this.repaginateWhenFontsSettle();
  }

  /** True while the caret sits in an editable floating textbox frame. */

  /**
   * Pagination and column balancing measure laid-out text, so they depend
   * on the actual font glyph metrics. A document's embedded fonts load
   * asynchronously — a pass that runs before they arrive (notably on a
   * cold reload, or right after `loadDocx` registers new faces) measures
   * with FALLBACK metrics, which can mis-balance columns or mis-place page
   * breaks. When fonts are still loading, re-run once they settle so the
   * final layout reflects real glyphs. No-op when nothing is pending
   * (the common warm-cache / steady-editing case), and a single in-flight
   * re-run is coalesced so rapid changes during a load don't pile up.
   */
  private repaginateWhenFontsSettle(): void {
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (!fonts || fonts.status !== "loading" || this.fontSettleScheduled) return;
    this.fontSettleScheduled = true;
    void fonts.ready.then(() => {
      this.fontSettleScheduled = false;
      if (!this.stack.root.classList.contains("is-zone-editing")) {
        this.stack.repaginate();
      }
    });
  }

  /** Delegate to `editor.getOutline()`. */
  getOutline(): OutlineItem[] {
    return this.editor.getOutline();
  }

  // === read/edit mode ===

  /** Current mode. Default is `"edit"`. */
  getMode(): SobreeMode {
    return this.mode;
  }

  /**
   * Switch between edit and read mode. Read mode turns off
   * `contenteditable`, tags the stack root with `is-read-mode` (so the
   * embedder / block tools can hide indicators and toolbars via CSS or
   * by listening to `mode-change`), and fires the `mode-change` event.
   *
   * Selection remains functional for copy / outline / accessibility;
   * only editing is suspended.
   */
  setMode(mode: SobreeMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    const editable = mode === "edit";
    // Toggle contenteditable on every content host (one per paper).
    for (const host of this.stack.contentHosts) {
      host.contentEditable = editable ? "true" : "false";
    }
    this.stack.root.classList.toggle("is-read-mode", !editable);
    // Repaint the floating layer so textbox frames pick up the new
    // editable state (`anchorLayerCtx` reads `is-read-mode` at paint
    // time): editable islands in edit mode, inert overlay in read mode.
    const doc = this.editor.getDocument();
    this.stack.setAnchoredFrames(doc.anchoredFrames ?? null, anchorRenderDeps(doc));
    for (const cb of this.listeners["mode-change"]) {
      try {
        cb({ mode });
      } catch (err) {
        console.error("[sobree] mode-change listener threw:", err);
      }
    }
  }

  // === track-changes (authoring mode) ===

  /**
   * Current track-changes state. See `TrackChangesState`.
   *
   * Thin proxy to `editor.getTrackChanges()` — exposed on the façade
   * so embedders driving the UI don't need to reach `sobree.editor`.
   */
  getTrackChanges(): TrackChangesState {
    return this.editor.getTrackChanges();
  }

  /**
   * Switch authoring mode. Delegates to `editor.setTrackChanges`,
   * which fires `track-changes-change`. Listeners attached to either
   * `editor.on("track-changes-change", …)` or
   * `sobree.on("track-changes-change", …)` receive the new state.
   *
   * The mode survives until flipped — it's not bound to selection or
   * document. To run a one-off tracked edit, save the previous state,
   * flip on, mutate, flip back.
   */
  setTrackChanges(state: TrackChangesState): void {
    this.editor.setTrackChanges(state);
  }

  // === DOCX I/O ===

  /**
   * Read a .docx file and load it into the editor. Fully native: the
   * parsed `SobreeDocument` is handed straight to the editor — no djot
   * intermediate.
   */
  async openDocx(src: File | Blob | ArrayBuffer | Uint8Array): Promise<void> {
    const { document, warnings } = await importDocx(src);
    // setDocument fires `change`; the change handler runs
    // `syncSetupFromDocument`, which re-derives `setup` from
    // `document.sections[0]`. So the imported page size / margins /
    // vAlign / titlePg / header-footer text all flow into the renderer
    // automatically — no explicit `setPageSetup` needed here.
    this.editor.setDocument(document);
    for (const cb of this.listeners["docx:import"]) {
      try {
        cb({ warnings });
      } catch (err) {
        console.error("[sobree] docx:import listener threw:", err);
      }
    }
  }

  /**
   * Export the current document as a .docx Blob. Reads the editor's AST
   * directly, overlays the current page setup's section/header/footer,
   * and serialises to OOXML.
   */
  exportDocx(): Blob {
    const doc = this.editor.getDocument();
    // Section 0 is the demo's editable layout (driven by `setup`);
    // anything past it (created via `section.insertBreakAfter` or by
    // import) survives intact. headerFooterBodies are merged so parts
    // referenced from later sections aren't dropped.
    const { section, headerFooterBodies } = pageSetupToSection(this.setup);
    doc.sections = [section, ...doc.sections.slice(1)];
    doc.headerFooterBodies = { ...doc.headerFooterBodies, ...headerFooterBodies };
    const { blob, warnings } = exportDocx(doc);
    for (const cb of this.listeners["docx:export"]) {
      try {
        cb({ warnings });
      } catch (err) {
        console.error("[sobree] docx:export listener threw:", err);
      }
    }
    return blob;
  }

  // === events ===

  on<E extends SobreeEvent>(
    event: E,
    cb: (payload: SobreeEventPayload[E]) => void,
  ): SobreeUnsubscribe {
    const set = this.listeners[event] as Set<(p: SobreeEventPayload[E]) => void>;
    set.add(cb);
    return () => set.delete(cb);
  }

  // === lifecycle ===

  /**
   * Compose the sections array the paper stack needs:
   *
   *   sections[0] is built from the live `setup` (the demo's UI model
   *   represents section 0; setPageSetup updates flow through here).
   *   sections[1..] come straight from the document AST — there's no UI
   *   for editing them yet, so they're effectively read-only until a
   *   future Page Setup section selector lands.
   *
   * Called whenever either source could have changed: constructor,
   * `change` event, `setPageSetup`.
   */
  private syncStackSections(): void {
    const doc = this.editor.getDocument();
    const fromSetup = pageSetupToSection(this.setup).section;
    // Preserve the AST section's header/footer refs over the setup-
    // derived ones. `pageSetupToSection` drops refs when the setup's
    // header / footer template is empty — which is exactly the state
    // on refresh (this.setup defaults to DEFAULT_PAGE_SETUP because
    // `options.initialDocument` is undefined when only `ydoc` is
    // passed). Without this preservation, `pickRichZone` walks back to
    // section 0, finds no refs, returns null, and the renderer falls
    // back to the legacy text-template path — jellap.docx's logo +
    // contact-info textbox header silently degrades to flat text on
    // every page reload.
    const section0 = doc.sections[0];
    if (section0) {
      fromSetup.headerRefs = section0.headerRefs;
      fromSetup.footerRefs = section0.footerRefs;
      if (section0.titlePage !== undefined) fromSetup.titlePage = section0.titlePage;
      // `PageSetup` models only the four page margins, so
      // `pageSetupToSection` fills the header/footer offsets (the
      // `<w:pgMar w:header/footer>` distances) with Word's factory
      // default (720tw). Sections 1+ come straight from the AST with the
      // document's real values, so without preserving them section 0's
      // running header sits at a different offset than the rest — the
      // logo / header content visibly jumps between page 1 and later
      // pages (jellap: 720tw → 12.7mm on page 1 vs the doc's 284tw →
      // 5mm on pages 2+). Same class as the refs preservation above.
      const m0 = section0.pageMargins;
      if (m0?.headerTwips !== undefined) fromSetup.pageMargins.headerTwips = m0.headerTwips;
      if (m0?.footerTwips !== undefined) fromSetup.pageMargins.footerTwips = m0.footerTwips;
    }
    const composed: SectionProperties[] = [fromSetup, ...doc.sections.slice(1)];
    this.stack.setSections(composed);
    // Mirror the rich header/footer AST + the dependencies renderBlocks
    // needs (numbering, styles, embedded media) onto the stack so the
    // headers render with their full formatting/images instead of being
    // collapsed to text via blocksToTemplate. When the doc has no
    // header parts at all we clear it — the legacy text-template path
    // (from PageSetup) takes over.
    const hasRichZones = Object.keys(doc.headerFooterBodies ?? {}).length > 0;
    this.stack.setRichZones(
      hasRichZones
        ? {
            headerFooterBodies: doc.headerFooterBodies,
            ...(doc.headerFooterFrames ? { headerFooterFrames: doc.headerFooterFrames } : {}),
            numbering: doc.numbering ?? [],
            styles: doc.styles ?? [],
            rawParts: doc.rawParts ?? {},
          }
        : null,
    );
    // Push anchored frames into the per-paper floating layer. The
    // lifter has been taught to skip anchored drawings (see
    // `liftTextBoxContent` — the `isAnchored` early-continue), so this
    // is the ONLY paint path for anchored content. Inline textboxes
    // are still lifted into body flow (the new layer doesn't yet
    // model inline positioning); that's the next slice of Phase B.
    this.stack.setAnchoredFrames(doc.anchoredFrames ?? null, anchorRenderDeps(doc));
  }

  /**
   * Re-derive `setup` from `doc.sections[0]` when they diverge.
   *
   * Why: every page-setup edit goes setup → AST via
   * `writeSetupToSection0`. But the inverse — AST → setup — only ran
   * at construction time. That left the renderer's `setup` stuck on
   * the post-edit state when the AST got reverted by undo / redo /
   * external Y-provider edits, so `Cmd+Z` for a margin change reverted
   * the AST silently while the paper kept the new margins.
   *
   * The `sameSetup` early-out is load-bearing — without it, the
   * `change` event fired by `editor.setDocument` inside
   * `writeSetupToSection0` would loop back into here, see the same
   * setup, and waste a re-paginate.
   */
  private syncSetupFromDocument(): void {
    const doc = this.editor.getDocument();
    const section = doc.sections[0];
    if (!section) return;
    const partial = sectionToPageSetup(section, doc.headerFooterBodies);
    const merged: PageSetup = { ...this.setup, ...partial };
    // `partial` only carries `header` / `footer` when the section
    // declares refs. Without explicit clearing here, importing a doc
    // with no footer (jellap.docx) keeps whatever Sobree default
    // ("Page {page} of {pages}") was on the prior `setup` — stamping
    // an unauthored footer onto every page. Respect "the document
    // says no header/footer" the same way `deriveSetupFromDocument`
    // does at construction.
    if (section.headerRefs.length === 0) merged.header = emptyZone();
    if (section.footerRefs.length === 0) merged.footer = emptyZone();
    if (sameSetup(this.setup, merged)) return;
    this.setup = merged;
    this.stack.updateSetup(this.setup);
    for (const cb of this.listeners.setup) {
      try {
        cb({ setup: this.getPageSetup() });
      } catch (err) {
        console.error("[sobree] setup listener threw:", err);
      }
    }
  }

  destroy(): void {
    // Plugins first, in reverse-attach order so the last-mounted is the
    // first-detached — symmetric with how listeners stack.
    for (let i = this.pluginDetachers.length - 1; i >= 0; i--) {
      try {
        this.pluginDetachers[i]?.();
      } catch (err) {
        console.error("[sobree] plugin detach threw:", err);
      }
    }
    this.pluginDetachers.length = 0;
    this.versionBadgeTeardown?.();
    this.versionBadgeTeardown = null;
    this.detachChange();
    this.detachPaginate();
    this.detachTrackChanges();
    this.listeners.change.clear();
    this.listeners.paginate.clear();
    this.listeners.setup.clear();
    this.listeners["mode-change"].clear();
    this.listeners["track-changes-change"].clear();
    this.listeners["docx:import"].clear();
    this.listeners["docx:export"].clear();
    this.editor.destroy();
    this.stack.destroy();
  }
}

/**
 * If `initialDocument` declares a section with headers/footers, project it
 * onto the legacy `PageSetup` shape so the paper stack picks up the
 * header/footer text without a round-trip through the page-setup modal.
 * Falls back to `DEFAULT_PAGE_SETUP` when no document is provided or when
 * the section is silent on layout.
 */
/**
 * The render deps the anchored-frame layer needs, pulled from the document
 * itself — so floating content paints whether or not the doc has
 * header/footer rich zones. See `PaperStack.setAnchoredFrames`.
 */
function anchorRenderDeps(doc: SobreeDocument): AnchorRenderDeps {
  return {
    rawParts: doc.rawParts ?? {},
    numbering: doc.numbering ?? [],
    styles: doc.styles ?? [],
  };
}

function deriveSetupFromDocument(doc: SobreeDocument | undefined): PageSetup {
  const base = structuredClone(DEFAULT_PAGE_SETUP);
  if (!doc) return base;
  const section = doc.sections[0];
  if (!section) return base;
  const partial = sectionToPageSetup(section, doc.headerFooterBodies);
  const merged: PageSetup = { ...base, ...partial };
  // `sectionToPageSetup` only emits `header` / `footer` when the
  // section declares refs. If it didn't, we used to keep the
  // `DEFAULT_PAGE_SETUP` defaults — which include
  // "Page {page} of {pages}" for the footer — and silently stamp them
  // onto every imported doc that has no footer (e.g. jellap.docx).
  // The author's intent was "no footer here"; respect it by clearing
  // the merged zone to an empty template.
  if (section.headerRefs.length === 0) merged.header = emptyZone();
  if (section.footerRefs.length === 0) merged.footer = emptyZone();
  return merged;
}

function emptyZone(): PageSetup["header"] {
  return {
    default: "",
    first: "",
    last: "",
    differentFirst: false,
    differentLast: false,
  };
}

/**
 * Shallow-equal two SectionProperties for the page-setup mirror's
 * early-out. JSON.stringify is fine: both come from `pageSetupToSection`
 * which produces deterministic, finite objects.
 */
function sameSection(a: SectionProperties, b: SectionProperties): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Shallow-equal two PageSetup snapshots — `syncSetupFromDocument`'s
 *  early-out, prevents the change → setup → AST → change → … loop. */
function sameSetup(a: PageSetup, b: PageSetup): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
