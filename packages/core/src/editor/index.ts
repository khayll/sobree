import "./editor.css";
import * as Y from "yjs";
import { BlobCache, type BlobStore } from "../blob";
import {
  type Range as ApiRange,
  type BlockRef,
  type EditError,
  type EditResult,
  type InlinePosition,
  type Selection,
  fail,
  lockConflict,
} from "../doc/api";
import { emptyDocument } from "../doc/builders";
import type { RunPropertiesPatch } from "../doc/runs";
import type { Block, InlineRun, SobreeDocument } from "../doc/types";
import type { EmbedFontFaces, EmbedFontOptions } from "../fonts";
import { FontFaceRegistry } from "../fonts";
import { History } from "../history";
import { projectYDoc, seedYDoc } from "../ydoc";
import { EditorCommands } from "./commands";
import type { EditorContext } from "./context";
import { registerCoreCommands } from "./coreCommands";
import { EditorEvents } from "./events";
import { BlockRegistry } from "./internal/blockRegistry";
import { ChangePipeline } from "./internal/changePipeline";
import { FrameController } from "./internal/frames";
import type { Mutation } from "./internal/mutations";
import { blockElementAtIndex, countBlocks } from "./internal/positionMap";
import { EditorNumbering } from "./numbering";
import * as blocks from "./ops/blocks";
import * as comments from "./ops/comments";
import * as parts from "./ops/parts";
import * as review from "./ops/review";
import * as runs from "./ops/runs";
import { type TrackedInput, createTrackedInput } from "./ops/trackedInput";
import * as query from "./query";
import { RenderedDocument } from "./renderedDocument";
import type { RenderedDocumentIndex } from "./renderedDocument";
import { EditorSections } from "./sections";
import { EditorSelection } from "./selection";
import { EditorStyles } from "./styles";
import { EditorTable } from "./table";
import { renderSobreeDocument } from "./view/docRenderer/index";
import { type EditorDomHooks, wireEditorDom } from "./wiring";
// EditorSelection + EditorCommands moved to ./selection / ./commands;
// re-exported here so the public surface (and HeadlessSobree) is unchanged.
export { EditorCommands } from "./commands";
export { EditorSelection } from "./selection";

// === exported types ===

export type { BlockRef, EditError, EditResult, InlinePosition, Selection };
// Editor-surface types are declared in ./types — extracted to keep this
// file focused on behaviour and to break the marks/mutations type cycle.
import type {
  ApiRangeType,
  BlockInfo,
  ChangePayload,
  CommandBus,
  CommandDefinition,
  CommandSnapshot,
  EditorEvent,
  EditorEventPayload,
  EditorOptions,
  KeyDownPayload,
  NamedStylePatch,
  OutlineItem,
  ParagraphPropertiesPatch,
  RevisionSpan,
  SectionPropertiesPatch,
  SelectionPayload,
  TrackChangesState,
  Unsubscribe,
  WrapTag,
} from "./types";
export type {
  ApiRangeType,
  BlockInfo,
  ChangePayload,
  CommandBus,
  CommandDefinition,
  CommandSnapshot,
  EditorEvent,
  EditorEventPayload,
  EditorOptions,
  KeyDownPayload,
  NamedStylePatch,
  OutlineItem,
  ParagraphPropertiesPatch,
  RevisionSpan,
  SectionPropertiesPatch,
  SelectionPayload,
  TrackChangesState,
  Unsubscribe,
  WrapTag,
};
// Table types re-exported through ./types (which sources them from ./table).
export type {
  CellRef,
  InsertAt,
  InsertColumnOpts,
  InsertRowOpts,
  MergeCellsOpts,
} from "./types";

export { runsLength } from "../doc/runs";
export type { RunPropertiesPatch };

// Rendered-document lookup surface — the typed bridge plugins use
// instead of hardcoding renderer DOM selectors.
export { RenderedDocument } from "./renderedDocument";
export type {
  RenderedBlockLookup,
  RenderedCommentLookup,
  RenderedCommentRange,
  RenderedDocumentIndex,
  RenderedRevisionKind,
  RenderedRevisionLookup,
  RenderedRevisionMark,
} from "./renderedDocument";

// === Editor ===

/**
 * Public editor surface.
 *
 * Two entry points for every operation:
 *   - Core methods take `BlockRef` / `InlinePosition` / `Range` and
 *     return `EditResult`. These are the wire-callable API — same
 *     contract for in-process toolbars, headless Y peers (HeadlessSobree),
 *     and future MCP wrappers.
 *   - "AtSelection" sugar reads the live DOM selection, builds the
 *     position/range for you, and delegates to the core. Use these in
 *     in-process UI code.
 *
 * Mutations enforce optimistic locking via block `version` numbers.
 * Conflicts return `{ ok: false, error: { code: "optimistic-lock", … } }`
 * rather than throwing.
 */

/**
 * Initial track-changes state for the constructor: a defensive clone of
 * the caller's option (so we never alias their object), or the off default.
 */
function initialTrackChanges(state: TrackChangesState | undefined): TrackChangesState {
  return state ? { ...state } : { enabled: false };
}

export class Editor {
  readonly host: HTMLElement;
  readonly selection: EditorSelection;
  /**
   * Ergonomic table operations — row/column insert-delete, cell merge /
   * unmerge, cell-level properties. Every method returns an `EditResult`
   * and inherits optimistic-lock checking via `replaceBlock`.
   */
  readonly table: EditorTable;
  /**
   * Section-level edit operations — page size / margins, columns,
   * header/footer references, vertical alignment. Grouped here (rather
   * than as flat `Editor` methods) so the facade stays thin as the
   * edit-op surface grows. Every method returns an `EditResult`.
   */
  readonly sections: EditorSections;
  /**
   * Named-style edit operations — define / update / remove the style
   * definitions content resolves through. Applying a `styleId` to content
   * is `applyBlockProperties` / `applyRunProperties`; this manages the
   * definitions themselves. Every method returns an `EditResult`.
   */
  readonly styles: EditorStyles;
  /**
   * Numbering / list-definition edit operations — define / update / remove
   * the list formats paragraphs reference by `numId`. Pointing a paragraph
   * at a list is `applyBlockProperties`; this manages the definitions.
   * Every method returns an `EditResult`.
   */
  readonly numbering: EditorNumbering;
  /**
   * Named-command registry — the coordination point between plugins.
   * Plugins register commands on attach and unregister on detach;
   * keyboard / toolbar / agent / MCP all dispatch through `execute()`.
   */
  readonly commands: CommandBus;

  /**
   * Typed lookup over the rendered DOM — maps rendered elements to
   * document concepts (blocks, revision marks, comment ranges) and back.
   * The sanctioned bridge between the renderer's private DOM shape and
   * plugins (`block-tools`, `review`, third-party): plugins call this
   * instead of hardcoding renderer selectors, so the DOM can evolve
   * without breaking them. See `./renderedDocument`.
   */
  readonly renderedDocument: RenderedDocumentIndex;

  /**
   * Y.Doc backing the document. The Editor's `this.doc` field is a
   * cached projection of this Y.Doc — every local mutation mirrors
   * into the Y.Doc inside a transact (`origin: "local"`). Embedders
   * read this for escape-hatch wiring (providers, dev tools, custom
   * persistence).
   *
   * Phase 1a: Y.Doc is a faithful mirror of `this.doc` but the Editor
   * still treats `this.doc` as the in-memory truth. Phase 1b inverts
   * this — Y.Doc becomes the truth and `this.doc` becomes a pure
   * cache invalidated by Y observers (which is what enables Phase 2
   * providers to drive the editor from outside).
   */
  readonly ydoc: Y.Doc;
  /**
   * Optional content-hashed blob layer (Phase 3.2+). When set, binary
   * parts (images, fonts) go through this rather than living inline
   * in the Y.Doc. `null` means "use the inline parts path" — today's
   * default. See `EditorOptions.blobStore`.
   */
  readonly blobStore: BlobStore | null;
  /**
   * Local cache for blob bytes — synchronously fetchable for the
   * renderer, populated by `blobStore.put` (local writes) or
   * `blobStore.get` (background fetches). `null` when no blobStore
   * is configured.
   */
  readonly blobCache: BlobCache | null;
  /** Most recent projection's partRefs map (path → hash). Used by
   *  `ensurePartsLoaded` and by the `onResolved` callback to know
   *  which paths reference a freshly-arrived blob. */
  private lastPartRefs: Record<string, string> = {};
  /**
   * Part paths whose bytes are in flight to the BlobStore — the
   * editor wrote them synchronously to `doc.rawParts` (so the local
   * renderer has them), but the async hash + upload + partRef write
   * is still pending. Mirror skips these so they don't end up inline
   * in the Y.Doc.
   */
  private readonly pendingPartRefMigrations: Set<string> = new Set();
  /** Removes every DOM/document listener + the Y.Doc subscription wired
   *  by `wireEditorDom`. Called once from `destroy()`. */
  private domTeardown: (() => void) | null = null;
  // Assigned by `initDocumentState` from the constructor (seed or adopt).
  private doc!: SobreeDocument;
  private readonly registry: BlockRegistry;
  private readonly debounceMs: number;
  private readonly getContentHosts: () => HTMLElement[];
  /** The editor's observable event surface (change / selection / keydown
   *  / track-changes-change). See `./events.ts`. */
  private readonly events = new EditorEvents();
  /**
   * Authoring mode for revisions. Off by default — mutations apply
   * plainly. On, `insertRun` / `deleteRange` route through
   * `applyTrackChangesToInsert` / `applyTrackChangesToDelete`. See the
   * `TrackChangesState` type docblock for the full semantics.
   */
  private trackChanges: TrackChangesState = { enabled: false };
  /**
   * Track-changes authoring input handler — routes tracked-mode
   * `beforeinput` / IME composition / paste through the typed API so
   * resulting runs carry revision markers. Holds the IME composition
   * snapshot + warn-once state. Built in the constructor. See
   * `ops/trackedInput`.
   */
  private trackedInput!: TrackedInput;
  /** Tracks `@font-face` registrations for the document's embedded fonts. */
  private readonly fontFaces = new FontFaceRegistry();
  /**
   * Undo / redo orchestrator. Snapshots the document at every commit
   * + at the start of each typing session (coalesced). Memory-efficient:
   * snapshots store doc references, not deep copies — the immutable-block
   * model means consecutive snapshots share most blocks. Public API is
   * `editor.history.undo() / redo() / clear() / depth() / on(...)`.
   */
  readonly history: History;
  /**
   * The editing context the caret was last in — a frame id, or `"body"`.
   * When it changes, the undo-capture group is closed so each box's edit
   * is a distinct undo step. `null` until the first selection.
   */
  private lastEditContext: string | null = null;
  /**
   * Editable-textbox-frame controller — owns the dirty-frame set, the
   * frame DOM read-back, and the pre-/post-edit selection capture/restore
   * that drives gold-standard frame undo. Built in the constructor. See
   * `./internal/frames.ts`.
   */
  private frames!: FrameController;
  /**
   * The change / sync pipeline — owns `revision`, the debounce handle, the
   * per-block JSON cache + `domDirty`, and the render → mirror → emit
   * cycle (`commit`, `syncFromDom`, `adoptYDocState`, …). Built in the
   * constructor. See `./internal/changePipeline.ts`.
   */
  private pipeline!: ChangePipeline;
  /**
   * Kernel seam handed to the behaviour modules (`ops/*`, `query`). Built
   * once in the constructor; closes over this instance's privates so the
   * `commit` pipeline / lock checks stay private to the class. See
   * `./context.ts`.
   */
  private readonly ctx: EditorContext;

  constructor(host: HTMLElement, options: EditorOptions = {}) {
    this.host = host;
    this.debounceMs = options.changeDebounceMs ?? 200;
    this.getContentHosts = options.contentHosts ?? (() => [host]);
    // Seed track-changes silently — no listeners can exist yet.
    this.trackChanges = initialTrackChanges(options.trackChanges);

    // Y.Doc backing — either user-provided (for providers / shared docs)
    // or freshly created. The BlockRegistry's id prefix incorporates the
    // Y.Doc's clientID so two peers don't both mint `b5` for different
    // blocks (Phase 1b: collision-safe across peers).
    this.ydoc = options.ydoc ?? new Y.Doc();
    const clientId = this.ydoc.clientID.toString(36);
    const idPrefix = `${clientId}_`;
    this.registry = new BlockRegistry({ idPrefix });
    this.blobStore = options.blobStore ?? null;
    this.blobCache = this.createBlobCache();

    this.selection = new EditorSelection(this);
    // Rendered-DOM lookup seam — searches the editor's content hosts and
    // resolves versions through the registry. Both are ready by now.
    this.renderedDocument = new RenderedDocument({
      roots: () => this.getContentHosts(),
      registry: () => this.registry,
    });
    this.table = new EditorTable(this);
    this.commands = new EditorCommands();
    this.history = this.createHistory();

    this.ctx = this.buildContext();
    // Frame controller + change pipeline operate over the context seam.
    // Built after `ctx` (they take it) but before `initDocumentState`,
    // which drives the pipeline's baseline + Y.Doc seed. The `History`
    // callbacks reference `this.frames` lazily, so the ordering is safe
    // (no undo can fire before construction completes).
    this.frames = new FrameController(this.ctx);
    this.pipeline = new ChangePipeline(this.ctx, this.events, this.frames, this.debounceMs);
    this.sections = new EditorSections(this.ctx);
    this.styles = new EditorStyles(this.ctx);
    this.numbering = new EditorNumbering(this.ctx);
    this.trackedInput = createTrackedInput(this.ctx);
    this.initDocumentState(options);

    // History + mark commands live on the bus (not the keyboard plugin)
    // so headless callers and Cmd+Z share one dispatch surface.
    registerCoreCommands(this.commands, this, this.history);

    this.mountHost(options);
    // All host/document listeners + image-resize + the remote-Y.Doc
    // subscription live in `wireEditorDom`, which returns one teardown.
    this.domTeardown = wireEditorDom(this.buildDomHooks());
  }

  /**
   * Optional content-hashed blob layer. The cache's `onResolved` callback
   * patches `doc.rawParts` and fires `change` so the renderer picks up a
   * freshly-arrived blob without an explicit refresh from the embedder.
   */
  private createBlobCache(): BlobCache | null {
    if (!this.blobStore) return null;
    return new BlobCache({
      store: this.blobStore,
      onResolved: (hash) => parts.onBlobResolved(this.ctx, hash),
    });
  }

  /**
   * History orchestrator — Phase 1b.6: backed by Y.UndoManager, which
   * observes the body / meta / parts top-level Y types and tracks
   * operations whose origin matches `localOrigin`. Local edits (mirrored
   * with origin "local") create stack items; remote-provider edits don't —
   * so `Cmd+Z` reverses only this peer's own edits. Selection capture /
   * restore is delegated to the {@link FrameController} (referenced lazily;
   * it's built right after this).
   */
  private createHistory(): History {
    return new History({
      ydoc: this.ydoc,
      localOrigin: "local",
      captureSelection: () => this.frames.captureSelectionForHistory(),
      capturePreEditSelection: () => this.frames.capturePreEditSelection(),
      restoreSelection: (sel) => this.frames.restoreCapturedSelection(sel),
      onGroupSettled: () => this.frames.clearPendingPreEditSelection(),
    });
  }

  /** Editor-attribute setup + the initial render of the seeded document. */
  private mountHost(options: EditorOptions): void {
    const { host } = this;
    host.classList.add("sobree-editor");
    host.contentEditable = "true";
    host.setAttribute("role", "textbox");
    host.setAttribute("aria-multiline", "true");
    host.spellcheck = true;

    const firstHost = this.getContentHosts()[0] ?? host;
    this.fontFaces.sync(this.doc.fonts, this.doc.rawParts);
    renderSobreeDocument(this.doc, firstHost, this.pipeline.blockIdsArray());
    if (options.showHiddenText) this.setShowHiddenText(true);
  }

  /** The hooks `wireEditorDom` calls — each forwards to the owning module. */
  private buildDomHooks(): EditorDomHooks {
    return {
      host: this.host,
      ctx: this.ctx,
      ydoc: this.ydoc,
      history: this.history,
      trackedInput: this.trackedInput,
      isTrackedEnabled: () => this.trackChanges.enabled,
      onBeforeInput: () => this.frames.onBeforeInput(),
      onInput: () => this.handleInput(),
      fireSelection: () => this.fireSelection(),
      fireKeyDown: (e) => this.fireKeyDown(e),
      adoptYDocState: () => this.pipeline.adoptYDocState(),
    };
  }

  /**
   * Route an `input` event. A caret inside an editable textbox frame reads
   * back into that frame's body (not the document body); everything else is
   * an ordinary body edit. Either way, schedule a debounced change.
   */
  private handleInput(): void {
    if (!this.frames.routeInput()) this.pipeline.markBodyDirty();
    this.pipeline.scheduleChange();
  }

  /**
   * Initialise `this.doc` + registry from the Y.Doc. Two paths, run
   * after the context exists so the adopt path can resolve cached part
   * refs through it:
   *   A. Empty Y.Doc (or none provided) → seed it from `initialDocument`
   *      (solo embedder, the v0.1 default).
   *   B. Y.Doc already has body content → adopt it (a provider populated
   *      the doc before construction; trust what's there).
   */
  private initDocumentState(options: EditorOptions): void {
    const ydocBody = this.ydoc.getArray<Y.Map<unknown>>("body");
    if (ydocBody.length === 0) {
      this.doc = options.initialDocument ?? emptyDocument();
      this.registry.reset(this.doc.body.length);
      this.pipeline.captureBaseline(this.doc);
      seedYDoc(this.ydoc, this.doc, this.pipeline.allBlockIds());
      this.lastPartRefs = {};
    } else {
      const projected = projectYDoc(this.ydoc);
      this.doc = projected.doc;
      this.registry.adoptIds(projected.ids);
      this.pipeline.captureBaseline(this.doc);
      this.lastPartRefs = projected.partRefs;
      parts.resolveCachedPartRefsInto(this.ctx, this.doc);
    }
  }

  /**
   * Assemble the {@link EditorContext} the behaviour modules operate on.
   * Closes over `this` so the kernel methods (`commit`, `checkRefs`, …)
   * stay private to the class while modules get a curated surface.
   */
  private buildContext(): EditorContext {
    const self = this;
    return {
      host: self.host,
      selection: self.selection,
      registry: self.registry,
      history: self.history,
      ydoc: self.ydoc,
      blobStore: self.blobStore,
      blobCache: self.blobCache,
      fontFaces: self.fontFaces,
      get doc() {
        return self.doc;
      },
      setDoc(doc) {
        self.doc = doc;
      },
      setDocument: (doc) => self.setDocument(doc),
      renderCurrent: () => self.pipeline.renderCurrent(),
      restoreSnapshot: (snapshot) => self.pipeline.restoreSnapshot(snapshot),
      getContentHosts: () => self.getContentHosts(),
      _hosts: () => self._hosts(),
      get trackChanges() {
        return self.trackChanges;
      },
      setTrackChangesRaw(state) {
        self.trackChanges = state;
      },
      get lastPartRefs() {
        return self.lastPartRefs;
      },
      setLastPartRefs(refs) {
        self.lastPartRefs = refs;
      },
      pendingPartRefMigrations: self.pendingPartRefMigrations,
      commit: <T = void>(
        update: Partial<SobreeDocument>,
        mutations: readonly Mutation[],
        value?: T,
        reason?: string,
      ) => self.pipeline.commit<T>(update, mutations, value, reason),
      ensureCurrent: () => self.pipeline.ensureCurrent(),
      syncFromDom: () => self.pipeline.syncFromDom(),
      checkRefs: (refs) => self.checkRefs(refs),
      checkRange: (range, expect) => self.checkRange(range, expect),
      emitChangeNow: () => self.pipeline.emitChangeNow(),
      mirrorToYDoc: () => self.pipeline.mirrorToYDoc(),
      scheduleChange: () => self.pipeline.scheduleChange(),
      setDomDirty: (value) => self.pipeline.setDomDirty(value),
    };
  }

  /**
   * Resolve any `partRefs` hashes that are currently cached into the
   * provided document's `rawParts`. In-place mutation — the document
   * is owned by the caller. Missing hashes stay out of `rawParts`;
   * the renderer handles missing parts gracefully (placeholder).
   */
  /**
   * Wait for every currently-referenced binary part to be available in
   * the local cache. Useful before `toDocx()` so the exported file
   * contains all images / fonts. Resolves immediately when no
   * `blobStore` is configured (bytes are always inline).
   */
  ensurePartsLoaded(): Promise<void> {
    return parts.ensurePartsLoaded(this.ctx);
  }

  // === primary document I/O ===

  /**
   * Current document as SobreeDocument.
   *
   * Syncs from the DOM only if the user typed since the last render. If
   * the latest change came from an API call, returns the in-memory AST
   * verbatim — the DOM is a projection of it and reading back would
   * throw away properties the renderer doesn't surface.
   */
  getDocument(): SobreeDocument {
    return this.pipeline.ensureCurrent();
  }

  /**
   * Show or hide hidden text (`<w:vanish/>`). Off by default (print-
   * faithful). A pure class flip on the editor root — no re-render, no
   * document change; hidden runs stay in the DOM either way. When shown
   * they get a muted dotted underline and become editable.
   */
  setShowHiddenText(show: boolean): void {
    this.host.classList.toggle("sobree-show-hidden", show);
  }

  /** Replace the document. Fires `change` synchronously. */
  setDocument(doc: SobreeDocument): void {
    // Phase 1b.6: Y.UndoManager auto-tracks the resulting Y operations
    // (via origin "local" applied by `mirrorToYDoc`), so no explicit
    // history recording is needed here.
    this.pipeline.applyDocument(doc);
  }

  /**
   * Drop entries from `rawParts` that nothing in the AST references.
   * Useful after deleting images (or font embeds — Phase 3) to keep the
   * in-memory doc lean. Idempotent; reports the keys that were removed.
   *
   * Not auto-invoked — `exportDocx` already filters at packaging time,
   * so callers only need this when they're keeping the doc around
   * in-memory across many edits.
   */
  pruneUnusedParts(): { kept: number; pruned: string[] } {
    return parts.pruneUnusedParts(this.ctx);
  }

  /**
   * Embed a TTF/OTF font into the document. Refuses (with a warning)
   * restricted fonts unless `opts.allowRestricted` is true. Pass any
   * subset of {regular, bold, italic, boldItalic}; missing faces are
   * simply not embedded.
   */
  embedFont(
    name: string,
    faces: EmbedFontFaces,
    opts: EmbedFontOptions = {},
  ): { warnings: string[] } {
    return parts.embedFont(this.ctx, name, faces, opts);
  }

  /**
   * Drop a font declaration by name. The associated font parts in
   * `rawParts` aren't immediately removed — call `pruneUnusedParts()`
   * (or just export) to GC them.
   */
  removeEmbeddedFont(name: string): void {
    parts.removeEmbeddedFont(this.ctx, name);
  }

  /** Monotonic counter bumped on each `change` event. */
  getRevision(): number {
    return this.pipeline.getRevision();
  }

  /** Monotonic document-wide version (bumps on any mutation). */
  getDocumentVersion(): number {
    return this.registry.documentVersion();
  }

  /** Render current document to an HTML string. */
  toHtml(): string {
    return query.toHtml(this.ctx);
  }

  // === block-level queries ===

  getBlocks(): BlockInfo[] {
    return query.getBlocks(this.ctx);
  }

  getBlock(index: number): BlockInfo {
    return query.getBlock(this.ctx, index);
  }

  /** Same summary, looked up by stable id. Returns `null` if unknown. */
  getBlockById(id: string): BlockInfo | null {
    return query.getBlockById(this.ctx, id);
  }

  getOutline(): OutlineItem[] {
    return query.getOutline(this.ctx);
  }

  // === core mutations (BlockRef / Position / Range in; EditResult out) ===

  /** Replace the block at `target`'s index with `block`. */
  replaceBlock(target: BlockRef, block: Block): EditResult<BlockRef> {
    return blocks.replaceBlock(this.ctx, target, block);
  }

  /**
   * Insert `block` before the target block. Returns the new ref. In
   * track-changes mode a paragraph block is stamped `revision: ins`;
   * non-paragraph blocks insert plain.
   */
  insertBlockBefore(target: BlockRef, block: Block): EditResult<BlockRef> {
    return blocks.insertBlockBefore(this.ctx, target, block);
  }

  /** Insert `block` after the target block. Returns the new ref. */
  insertBlockAfter(target: BlockRef, block: Block): EditResult<BlockRef> {
    return blocks.insertBlockAfter(this.ctx, target, block);
  }

  /**
   * Delete the target block. In track-changes mode paragraph blocks are
   * stamped `del` (kept visible) rather than removed; tables / section
   * breaks remove plainly.
   */
  deleteBlock(target: BlockRef): EditResult<void> {
    return blocks.deleteBlock(this.ctx, target);
  }

  /** Merge a patch into each target paragraph's properties. */
  applyBlockProperties(targets: BlockRef[], patch: ParagraphPropertiesPatch): EditResult<void> {
    return blocks.applyBlockProperties(this.ctx, targets, patch);
  }

  /**
   * Apply run-level properties across `range`.
   *
   * In track-changes mode (see `setTrackChanges`), each text run in
   * `range` that doesn't already carry a `revisionFormat` snapshot
   * gets one — capturing the run's properties *before* the patch is
   * applied. Repeated tracked edits don't overwrite the snapshot, so
   * a reject always returns the run to its pre-tracking state.
   * Non-text runs and runs with no concrete properties pass through
   * unchanged.
   */
  applyRunProperties(
    range: ApiRange,
    patch: RunPropertiesPatch,
    opts: { expect?: Record<string, number> } = {},
  ): EditResult<void> {
    return runs.applyRunProperties(this.ctx, range, patch, opts);
  }

  /** Wrap the runs in `range` with semantic formatting. */
  wrapRange(
    range: ApiRange,
    tag: WrapTag,
    opts: { expect?: Record<string, number> } = {},
  ): EditResult<void> {
    return runs.wrapRange(this.ctx, range, tag, opts);
  }

  /**
   * Insert a run at `at`. In track-changes mode the run is stamped
   * `revision: ins` unless it already carries one.
   */
  insertRun(at: InlinePosition, run: InlineRun): EditResult<BlockRef> {
    return runs.insertRun(this.ctx, at, run);
  }

  /**
   * Split a paragraph at `at`; runs after the offset move into a new
   * paragraph inserted after, inheriting the original's properties.
   * Returns the new (second) block's ref. In track-changes mode the new
   * paragraph is stamped `revision: ins`.
   */
  splitBlock(at: InlinePosition): EditResult<BlockRef> {
    return runs.splitBlock(this.ctx, at);
  }

  /**
   * Insert an image at `at`. Bytes are stored in `doc.rawParts` and a
   * `DrawingRun` is inserted; with a `blobStore` configured the bytes
   * migrate to the store in the background.
   */
  insertImage(
    at: InlinePosition,
    bytes: Uint8Array,
    opts: { mime: string; widthPx?: number; heightPx?: number; altText?: string },
  ): EditResult<BlockRef> {
    return runs.insertImage(this.ctx, at, bytes, opts);
  }

  /**
   * Delete the content inside `range`. Supports both single-block and
   * cross-paragraph ranges.
   *
   * In track-changes mode (see `setTrackChanges`), the deletion is
   * *recorded* rather than applied:
   *   - plain runs are stamped with `revision: { type: "del", author }`;
   *   - a run already marked as the same author's pending `ins` is
   *     dropped (the author cancelling their own un-committed insert
   *     — no audit trail because it was never committed);
   *   - runs carrying a peer's revision (any author other than the
   *     current one) are left untouched: the API user should resolve
   *     those via `acceptRevision` / `rejectRevision` first.
   *
   * **Cross-paragraph behaviour**: in tracked mode every paragraph
   * *after* the first one in the range gets its paragraph-mark
   * stamped `del` too, so `acceptAllRevisions` later collapses the
   * range into a single paragraph. In non-tracked mode the
   * intermediate paragraphs are removed outright and the first +
   * last blocks merge into one.
   */
  deleteRange(range: ApiRange, opts: { expect?: Record<string, number> } = {}): EditResult<void> {
    return runs.deleteRange(this.ctx, range, opts);
  }

  // === tracked changes — authoring mode ===

  /**
   * Read the current track-changes mode. Defaults to `{ enabled: false }`
   * — the editor mutates the document plainly. See `setTrackChanges`.
   *
   * Returns a fresh copy each call, so callers can mutate the returned
   * object without affecting editor state.
   */
  getTrackChanges(): TrackChangesState {
    return { ...this.trackChanges };
  }

  /**
   * Switch authoring mode. When `enabled`, subsequent `insertRun` and
   * `deleteRange` calls produce tracked revisions instead of direct
   * mutations (see `TrackChangesState`'s docblock for the full rules).
   *
   * Fires `track-changes-change` if the state actually changes
   * (idempotent — re-setting the same enabled+author is a no-op).
   * Listeners receive the new state; embedders typically forward it
   * to a toolbar pill / mode badge.
   */
  setTrackChanges(state: TrackChangesState): void {
    const same =
      this.trackChanges.enabled === state.enabled && this.trackChanges.author === state.author;
    if (same) return;
    this.trackChanges = { ...state };
    this.events.emitTrackChanges({ ...this.trackChanges });
  }

  // === tracked changes & comments — review actions ===

  /**
   * Accept the tracked changes inside `range`: insertions become
   * permanent (the revision marker is stripped, text kept), deletions
   * are applied (the deleted text is dropped). Runs in `range` with no
   * revision marker pass through untouched, so it's safe to pass a
   * range slightly wider than the change.
   */
  acceptRevision(
    range: ApiRange,
    opts: { expect?: Record<string, number> } = {},
  ): EditResult<void> {
    return review.acceptRevision(this.ctx, range, opts);
  }

  /** Reject the tracked changes inside `range`. Inverse of `acceptRevision`. */
  rejectRevision(
    range: ApiRange,
    opts: { expect?: Record<string, number> } = {},
  ): EditResult<void> {
    return review.rejectRevision(this.ctx, range, opts);
  }

  /** Accept tracked format changes inside `range` (drop the snapshot). */
  acceptFormatRevision(
    range: ApiRange,
    opts: { expect?: Record<string, number> } = {},
  ): EditResult<void> {
    return review.acceptFormatRevision(this.ctx, range, opts);
  }

  /** Reject tracked format changes inside `range` (revert to `before`). */
  rejectFormatRevision(
    range: ApiRange,
    opts: { expect?: Record<string, number> } = {},
  ): EditResult<void> {
    return review.rejectFormatRevision(this.ctx, range, opts);
  }

  /**
   * Accept the paragraph-mark revision on `target`. `ins` strips the
   * marker (the break stays); `del` merges this paragraph into the
   * previous one.
   */
  acceptParagraphRevision(target: BlockRef): EditResult<void> {
    return review.acceptParagraphRevision(this.ctx, target);
  }

  /**
   * Reject the paragraph-mark revision on `target`. `ins` undoes the
   * split (merge into previous); `del` strips the marker.
   */
  rejectParagraphRevision(target: BlockRef): EditResult<void> {
    return review.rejectParagraphRevision(this.ctx, target);
  }

  /**
   * Enumerate every logical tracked change. Consecutive same-author
   * revision runs coalesce into one `RevisionSpan` with fresh versioned
   * refs. Re-query after each `change`.
   */
  getRevisions(): RevisionSpan[] {
    return review.getRevisions(this.ctx);
  }

  /**
   * Accept every tracked change in the document (optionally filtered by
   * `opts.author`). One commit for the whole sweep.
   */
  acceptAllRevisions(opts: { author?: string } = {}): EditResult<void> {
    return review.acceptAllRevisions(this.ctx, opts);
  }

  /** Reject every tracked change (optionally filtered by author). */
  rejectAllRevisions(opts: { author?: string } = {}): EditResult<void> {
    return review.rejectAllRevisions(this.ctx, opts);
  }

  /** Mark comment `id` resolved (`Comment.done = true`). */
  resolveComment(id: number): EditResult<void> {
    return comments.resolveComment(this.ctx, id);
  }

  /** Re-open a resolved comment `id` (`Comment.done = false`). */
  reopenComment(id: number): EditResult<void> {
    return comments.reopenComment(this.ctx, id);
  }

  // === AtSelection sugar — DOM-aware convenience wrappers ===

  setBlockPropertiesAtSelection(patch: ParagraphPropertiesPatch): EditResult<void> {
    const blockRef = this.selection.currentBlock();
    if (!blockRef) return fail({ code: "invalid-position", details: "no selection" });
    return this.applyBlockProperties([blockRef], patch);
  }

  setRunPropertiesAtSelection(patch: RunPropertiesPatch): EditResult<void> {
    const range = this.selection.currentRange();
    if (!range) return fail({ code: "invalid-position", details: "no selection" });
    return this.applyRunProperties(range, patch);
  }

  wrapSelection(tag: WrapTag): EditResult<void> {
    const range = this.selection.currentRange();
    if (!range) return fail({ code: "invalid-position", details: "no selection" });
    return this.wrapRange(range, tag);
  }

  insertImageAtSelection(
    bytes: Uint8Array,
    opts: { mime: string; widthPx?: number; heightPx?: number; altText?: string },
  ): EditResult<BlockRef> {
    return runs.insertImageAtSelection(this.ctx, bytes, opts);
  }

  /**
   * Unwrap span ancestors intersecting the selection, up to the block.
   * Best-effort DOM-level cleanup — preserves the in-place UX without a
   * re-render.
   */
  clearInlineFormattingAtSelection(): void {
    runs.clearInlineFormattingAtSelection(this.ctx);
  }

  // === events + lifecycle ===

  on<E extends EditorEvent>(event: E, cb: (p: EditorEventPayload[E]) => void): Unsubscribe {
    return this.events.on(event, cb);
  }

  destroy(): void {
    this.pipeline.cancelPending();
    // Removes all DOM/document listeners, image-resize handles, the
    // Y.Doc subscription, and resets the tracked-input snapshot.
    this.domTeardown?.();
    this.domTeardown = null;
    this.fontFaces.destroy();
    this.history.destroy();
    for (const h of this.getContentHosts()) h.replaceChildren();
    this.host.removeAttribute("contenteditable");
    this.host.classList.remove("sobree-editor");
    this.events.clear();
  }

  // === internal accessors (used by EditorSelection) ===

  /** @internal */
  _hosts(): HTMLElement[] {
    return this.getContentHosts();
  }

  /** @internal */
  _registry(): BlockRegistry {
    return this.registry;
  }

  /** @internal */
  _blockElementAt(index: number): HTMLElement | null {
    return blockElementAtIndex(this._hosts(), index);
  }

  // === internals ===

  private checkRefs(refs: readonly BlockRef[]): EditResult<never> | null {
    const conflicts: Array<{ blockId: string; expected: number; actual: number | null }> = [];
    for (const ref of refs) {
      const live = this.registry.refById(ref.id);
      if (!live) {
        conflicts.push({ blockId: ref.id, expected: ref.version, actual: null });
        continue;
      }
      if (live.version !== ref.version) {
        conflicts.push({ blockId: ref.id, expected: ref.version, actual: live.version });
      }
    }
    return conflicts.length > 0 ? lockConflict(conflicts) : null;
  }

  private checkRange(
    range: ApiRange,
    expect: Record<string, number> | undefined,
  ): EditResult<never> | null {
    const refs: BlockRef[] = [range.from.block, range.to.block];
    if (expect) {
      for (const [id, version] of Object.entries(expect)) refs.push({ id, version });
    }
    return this.checkRefs(refs);
  }

  /**
   * Toggle a mark on the caret inside an editable textbox frame, natively
   * (`document.execCommand`). Returns false when the caret isn't in a
   * frame, so the mark command falls back to the body path. See
   * {@link FrameController.applyFrameMark}.
   */
  applyFrameMark(tag: string): boolean {
    return this.frames.applyFrameMark(tag);
  }

  /** Active state of `tag` at a frame caret (toolbar highlight), or null
   *  when the caret isn't in a frame. */
  frameMarkActive(tag: string): boolean | null {
    return this.frames.frameMarkActive(tag);
  }

  /**
   * Compose the current selection into a {@link SelectionPayload} and
   * dispatch to subscribers. Called from the document-level
   * `selectionchange` listener attached in the constructor; safe to fire
   * even when no subscribers exist (the early-return keeps it cheap).
   */
  private fireSelection(): void {
    this.breakUndoOnContextChange();
    this.events.emitSelection(this.selection.get());
  }

  /**
   * When the caret moves to a different editing context — another textbox
   * frame, or between a frame and the body — close the undo-capture group
   * so the next edit there is its own undo step. Without this, two edits
   * to different boxes within `captureTimeout` coalesce and a single undo
   * reverts both, unlike Word (where each box is a distinct action).
   */
  private breakUndoOnContextChange(): void {
    const context = this.frames.editedFrameId() ?? "body";
    if (context !== this.lastEditContext) {
      this.lastEditContext = context;
      this.history.stopCapturing();
    }
  }

  private fireKeyDown(e: KeyboardEvent): void {
    this.events.emitKeyDown(e);
  }
}

// Re-export countBlocks for any callers that need it.
export { countBlocks };
