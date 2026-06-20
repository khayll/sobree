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
  ok,
} from "../doc/api";
import { emptyDocument } from "../doc/builders";
import type { RunPropertiesPatch } from "../doc/runs";
import type { Block, InlineRun, SobreeDocument } from "../doc/types";
import type { EmbedFontFaces, EmbedFontOptions } from "../fonts";
import { FontFaceRegistry } from "../fonts";
import { History } from "../history";
import { applyDocumentToYDoc, projectYDoc, seedYDoc } from "../ydoc";
import { EditorCommands } from "./commands";
import type { EditorContext } from "./context";
import { registerCoreCommands } from "./coreCommands";
import { EditorEvents } from "./events";
import { BlockRegistry } from "./internal/blockRegistry";
import type { Mutation } from "./internal/mutations";
import { applySelectionToDom, blockElementAtIndex, countBlocks } from "./internal/positionMap";
import { EditorNumbering } from "./numbering";
import * as blocks from "./ops/blocks";
import * as comments from "./ops/comments";
import * as parts from "./ops/parts";
import * as review from "./ops/review";
import * as runs from "./ops/runs";
import { type TrackedInput, createTrackedInput } from "./ops/trackedInput";
import * as query from "./query";
import { EditorSections } from "./sections";
import { EditorSelection } from "./selection";
import { EditorStyles } from "./styles";
import { EditorTable } from "./table";
import { renderSobreeDocument } from "./view/docRenderer/index";
import { serializeHostsToDocument } from "./view/docSerialize/index";
import { wireEditorDom } from "./wiring";
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
 * Mark tag → `document.execCommand` name, for applying a toggle mark
 * inside an editable textbox frame (where the body-selection path can't
 * reach). The native commands produce `<b>`/`<i>`/`<u>`/… which the
 * frame read-back's inline serializer maps back to run properties.
 */
const MARK_EXEC_COMMAND: Record<string, string> = {
  strong: "bold",
  em: "italic",
  u: "underline",
  s: "strikeThrough",
  sup: "superscript",
  sub: "subscript",
};

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
  private debounceHandle: number | null = null;
  private revision = 0;
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
  /** Cached last-seen per-block JSON strings, for diff-based version bumps. */
  private lastSerialisedBlocks: string[] = [];
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
   * True when DOM mutations since the last sync were user-driven (typing,
   * paste, drag-drop image). False right after we render from AST — the
   * DOM is then a projection of `this.doc`, and reading it back can't
   * tell us anything the AST doesn't already know, while losing any
   * fidelity the serializer drops (column widths, vAlign, …). `getDocument`
   * and `emitChangeNow` sync only when this flag is set.
   */
  private domDirty = false;
  /**
   * Ids of editable textbox frames whose DOM the user has edited since
   * the last sync. Frames live in the floating overlay (outside the
   * body content hosts), so they need their own read-back path —
   * `syncFromDom` re-serialises each dirty frame into
   * `anchoredFrames[id].content.body`.
   */
  private readonly dirtyFrameIds = new Set<string>();
  /**
   * Set by `syncFromDom` when the pending change was a pure live frame
   * keystroke; read (and reset) by `emitChangeNow` into the change
   * payload's `liveFrameEdit`. Lets the host skip the overlay repaint
   * that would clobber the caret, while still repainting on undo/remote.
   */
  private pendingLiveFrameEdit = false;
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
    if (options.trackChanges) {
      // Seed silently — no listeners can exist yet, so no event needed.
      this.trackChanges = { ...options.trackChanges };
    }

    // Y.Doc backing — either user-provided (for providers / shared docs)
    // or freshly created. The BlockRegistry's id prefix incorporates the
    // Y.Doc's clientID so two peers don't both mint `b5` for different
    // blocks (Phase 1b: collision-safe across peers).
    this.ydoc = options.ydoc ?? new Y.Doc();
    this.registry = new BlockRegistry({
      idPrefix: `${this.ydoc.clientID.toString(36)}_`,
    });

    // Optional content-hashed blob layer. The cache's `onResolved`
    // callback patches `this.doc.rawParts` and fires `change` so the
    // renderer picks up a freshly-arrived blob without an explicit
    // refresh from the embedder.
    this.blobStore = options.blobStore ?? null;
    this.blobCache = this.blobStore
      ? new BlobCache({
          store: this.blobStore,
          onResolved: (hash) => parts.onBlobResolved(this.ctx, hash),
        })
      : null;

    this.selection = new EditorSelection(this);
    this.table = new EditorTable(this);
    this.commands = new EditorCommands();

    // History orchestrator — Phase 1b.6: backed by Y.UndoManager. The
    // UndoManager observes the body / meta / parts top-level Y types
    // and tracks operations whose origin matches `localOrigin`. Local
    // edits (mirrored by `mirrorToYDoc()` with origin "local") create
    // stack items; remote-provider edits (any other origin) don't —
    // so `Cmd+Z` reverses only this peer's own edits.
    //
    // Selection is captured per stack-item-added (the post-edit
    // selection — the pre-edit selection capture is handled by the
    // beforeInput listener stashing) and restored on stack-item-popped
    // after the Y observer has re-projected and re-rendered.
    this.history = new History({
      ydoc: this.ydoc,
      localOrigin: "local",
      captureSelection: () => this.selection.get(),
      restoreSelection: (sel) => {
        if (sel) applySelectionToDom(this._hosts(), this.registry, sel);
      },
    });

    this.ctx = this.buildContext();
    this.sections = new EditorSections(this.ctx);
    this.styles = new EditorStyles(this.ctx);
    this.numbering = new EditorNumbering(this.ctx);
    this.trackedInput = createTrackedInput(this.ctx);
    this.initDocumentState(options);

    // History + mark commands live on the bus (not the keyboard plugin)
    // so headless callers and Cmd+Z share one dispatch surface.
    registerCoreCommands(this.commands, this, this.history);

    host.classList.add("sobree-editor");
    host.contentEditable = "true";
    host.setAttribute("role", "textbox");
    host.setAttribute("aria-multiline", "true");
    host.spellcheck = true;

    const firstHost = this.getContentHosts()[0] ?? host;
    this.fontFaces.sync(this.doc.fonts, this.doc.rawParts);
    renderSobreeDocument(this.doc, firstHost, this.blockIdsArray());
    if (options.showHiddenText) this.setShowHiddenText(true);

    // All host/document listeners + image-resize + the remote-Y.Doc
    // subscription live in `wireEditorDom`, which returns one teardown.
    this.domTeardown = wireEditorDom({
      host,
      ctx: this.ctx,
      ydoc: this.ydoc,
      history: this.history,
      trackedInput: this.trackedInput,
      isTrackedEnabled: () => this.trackChanges.enabled,
      onInput: () => {
        // Route the edit: a caret inside an editable textbox frame reads
        // back into that frame's body, NOT the document body. Everything
        // else is an ordinary body edit.
        const frameId = this.editedFrameId();
        if (frameId !== null) this.dirtyFrameIds.add(frameId);
        else this.domDirty = true;
        this.scheduleChange();
      },
      fireSelection: () => this.fireSelection(),
      fireKeyDown: (e) => this.fireKeyDown(e),
      adoptYDocState: () => this.adoptYDocState(),
    });
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
      this.lastSerialisedBlocks = this.doc.body.map((b) => JSON.stringify(b));
      seedYDoc(this.ydoc, this.doc, this.allBlockIds());
      this.lastPartRefs = {};
    } else {
      const projected = projectYDoc(this.ydoc);
      this.doc = projected.doc;
      this.registry.adoptIds(projected.ids);
      this.lastSerialisedBlocks = this.doc.body.map((b) => JSON.stringify(b));
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
      renderCurrent: () => self.renderCurrent(),
      restoreSnapshot: (snapshot) => self.restoreSnapshot(snapshot),
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
      ) => self.commit<T>(update, mutations, value, reason),
      ensureCurrent: () => self.ensureCurrent(),
      syncFromDom: () => self.syncFromDom(),
      checkRefs: (refs) => self.checkRefs(refs),
      checkRange: (range, expect) => self.checkRange(range, expect),
      emitChangeNow: () => self.emitChangeNow(),
      mirrorToYDoc: () => self.mirrorToYDoc(),
      scheduleChange: () => self.scheduleChange(),
      setDomDirty: (value) => {
        self.domDirty = value;
      },
    };
  }

  /**
   * Re-project the Y.Doc into `this.doc`, sync the BlockRegistry to
   * the projected ids, re-render the DOM, and fire `change`. Called
   * when a remote provider applies an update we didn't initiate.
   */
  private adoptYDocState(): void {
    const projected = projectYDoc(this.ydoc);
    this.doc = projected.doc;
    this.registry.adoptIds(projected.ids);
    this.lastSerialisedBlocks = this.doc.body.map((b) => JSON.stringify(b));
    this.lastPartRefs = projected.partRefs;
    // Resolve hash-addressed parts through the local cache. Hashes
    // not yet cached: kick off background fetches; `onBlobResolved`
    // patches + re-renders when they land.
    parts.resolveCachedPartRefsInto(this.ctx, this.doc);
    if (this.blobCache) {
      const missing = Object.values(projected.partRefs).filter((h) => !this.blobCache!.has(h));
      if (missing.length > 0) {
        void this.blobCache.ensureLoaded(missing);
      }
    }
    const hosts = this.getContentHosts();
    for (const h of hosts) h.replaceChildren();
    const firstHost = hosts[0] ?? this.host;
    this.fontFaces.sync(this.doc.fonts, this.doc.rawParts);
    renderSobreeDocument(this.doc, firstHost, this.blockIdsArray());
    this.domDirty = false;
    this.emitChangeNow();
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
    return this.ensureCurrent();
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
    this.applyDocument(doc);
  }

  /**
   * Internal apply path shared by `setDocument` and any other
   * full-replace caller. The Y.Doc mirror produces tracked Y
   * operations that Y.UndoManager turns into a single stack item.
   */
  private applyDocument(doc: SobreeDocument): void {
    this.doc = doc;
    this.registry.reset(doc.body.length);
    this.lastSerialisedBlocks = doc.body.map((b) => JSON.stringify(b));
    this.renderCurrent();
    this.domDirty = false;
    this.mirrorToYDoc();
    this.emitChangeNow();
  }

  /**
   * Re-render the current `doc` into the content hosts. Syncs
   * `@font-face` registrations BEFORE rendering so newly-embedded fonts
   * are available to the render pass. No selection restore, no change
   * emit — callers sequence those.
   */
  private renderCurrent(): void {
    const hosts = this.getContentHosts();
    for (const h of hosts) h.replaceChildren();
    const firstHost = hosts[0] ?? this.host;
    this.fontFaces.sync(this.doc.fonts, this.doc.rawParts);
    renderSobreeDocument(this.doc, firstHost, this.blockIdsArray());
  }

  /**
   * Soft-revert to a doc `snapshot` and re-render. Resets the
   * serialised-block cache + dom-dirty flag; no registry reset, mirror, or
   * change emit. Used to undo native IME mutations before a tracked
   * re-insert (see `ops/trackedInput`).
   */
  private restoreSnapshot(snapshot: SobreeDocument): void {
    this.doc = snapshot;
    this.lastSerialisedBlocks = snapshot.body.map((b) => JSON.stringify(b));
    this.domDirty = false;
    this.renderCurrent();
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
    return this.revision;
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
    if (this.debounceHandle !== null) {
      window.clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
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

  /**
   * Parallel array of live block ids (same length as `doc.body`), used
   * by the renderer to stamp `data-block-id` onto every block element.
   * Lets external tools (block tools, embedders) locate a block's DOM
   * element after the body is re-rendered from scratch.
   */
  private blockIdsArray(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.doc.body.length; i++) {
      out.push(this.registry.refAt(i).id);
    }
    return out;
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
   * Apply a mutation to `this.doc`, update the registry, re-render, fire
   * change. Returns the affected refs (post-bump).
   */
  private commit<T = void>(
    update: Partial<SobreeDocument>,
    mutations: readonly Mutation[],
    value?: T,
    _reason = "commit",
  ): EditResult<T> {
    const savedSelection = this.selection.get();

    // Phase 1b.6: Y.UndoManager auto-tracks the resulting Y operations
    // via origin "local" (set by `mirrorToYDoc`). No explicit
    // pre-commit recording needed.

    const next: SobreeDocument = { ...this.doc, ...update };

    // Apply registry mutations first so `affected` reports new versions.
    const affected: BlockRef[] = [];
    for (const m of mutations) {
      if (m.type === "insert") affected.push(this.registry.insert(m.index));
      else if (m.type === "remove") this.registry.remove(m.index);
      else if (m.type === "bump") affected.push(this.registry.bump(m.index));
    }

    this.doc = next;
    this.lastSerialisedBlocks = next.body.map((b) => JSON.stringify(b));
    const hosts = this.getContentHosts();
    for (const h of hosts) h.replaceChildren();
    const firstHost = hosts[0] ?? this.host;
    renderSobreeDocument(this.doc, firstHost, this.blockIdsArray());

    // Best-effort selection restore (block must still exist + offset still valid).
    if (savedSelection) applySelectionToDom(this._hosts(), this.registry, savedSelection);

    this.domDirty = false;
    this.mirrorToYDoc();
    this.emitChangeNow();
    return ok<T>(value as T, affected);
  }

  /**
   * Ensure `this.doc` reflects the latest edits. If the DOM has been
   * dirtied by user typing / paste / drop, pull the latest content out
   * of it and bump affected block versions. If the last mutation came
   * from the API, the AST is already current — skip the (lossy)
   * DOM-to-AST round-trip.
   */
  private ensureCurrent(): SobreeDocument {
    if (!this.domDirty && this.dirtyFrameIds.size === 0) return this.doc;
    return this.syncFromDom();
  }

  private syncFromDom(): SobreeDocument {
    // Classify the change so the host knows whether the floating overlay
    // is already current (live frame typing) or stale (anything else).
    const bodyChanged = this.domDirty;
    const frameChanged = this.dirtyFrameIds.size > 0;
    this.pendingLiveFrameEdit = frameChanged && !bodyChanged;
    // Body read-back — only when a body host actually changed. A pure
    // frame edit (domDirty false) must NOT re-serialise the body: that
    // would churn the registry and risk clobbering AST-only properties.
    if (this.domDirty) {
      const serialised = serializeHostsToDocument(this.getContentHosts());
      const prevCount = this.registry.length();
      const newCount = serialised.body.length;

      if (newCount !== prevCount) {
        // Structural change (user pressed Enter / Backspace, paste inserted
        // blocks): we can't preserve ids across structural shifts cheaply,
        // so re-stamp. Agents that held stale refs will see lock failures.
        this.registry.reset(newCount);
      } else {
        // Same count: detect which blocks' serialised JSON changed.
        const newJson = serialised.body.map((b) => JSON.stringify(b));
        const changed: boolean[] = newJson.map((j, i) => j !== this.lastSerialisedBlocks[i]);
        this.lastSerialisedBlocks = newJson;
        this.registry.bumpChanged(changed);
      }
      this.doc = {
        ...this.doc,
        body: serialised.body,
        numbering: serialised.numbering,
      };
      this.domDirty = false;
    }
    // Frame read-back — re-serialise each edited textbox frame's DOM into
    // its `content.body`. Frames live in the floating overlay, outside the
    // body hosts, so they're invisible to the body serializer above.
    if (this.dirtyFrameIds.size > 0) this.syncFramesFromDom();
    this.mirrorToYDoc();
    return this.doc;
  }

  /**
   * Re-read the DOM of each dirty editable textbox frame into the AST.
   * The frame element IS the serialization host (the block renderer paints
   * its body directly into it), so `serializeHostsToDocument([el])` yields
   * the same `Block[]` shape as a body host. Matched to the AST frame by
   * its stable `data-anchor-id`. Pure body swap — geometry/anchor untouched.
   */
  private syncFramesFromDom(): void {
    const frames = this.doc.anchoredFrames;
    if (!frames || frames.length === 0) {
      this.dirtyFrameIds.clear();
      return;
    }
    const elById = new Map<string, HTMLElement>();
    for (const el of this.host.querySelectorAll<HTMLElement>(
      ".paper-anchor[data-anchor-textbox]",
    )) {
      if (el.dataset.anchorId) elById.set(el.dataset.anchorId, el);
    }
    let changed = false;
    const next = frames.map((f) => {
      if (!this.dirtyFrameIds.has(f.id) || f.content.kind !== "textbox") return f;
      const el = elById.get(f.id);
      if (!el) return f;
      const body = serializeHostsToDocument([el]).body;
      changed = true;
      return { ...f, content: { ...f.content, body } };
    });
    this.dirtyFrameIds.clear();
    if (changed) this.doc = { ...this.doc, anchoredFrames: next };
  }

  /**
   * The id of the editable textbox frame the caret currently sits in, or
   * null when the selection is in ordinary body flow. Used to route an
   * `input` event to the frame read-back instead of the body read-back.
   */
  private editedFrameId(): string | null {
    const sel = this.host.ownerDocument.getSelection();
    let node: Node | null = sel?.anchorNode ?? null;
    if (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
    const frame = (node as Element | null)?.closest?.(".paper-anchor[data-anchor-textbox]");
    return (frame as HTMLElement | null)?.dataset.anchorId ?? null;
  }

  /**
   * Toggle a mark on the caret inside an editable textbox frame, natively
   * (`document.execCommand`), so the body-selection mark path doesn't have
   * to understand frame coordinates. The resulting `<b>`/`<i>`/`<u>` tags
   * round-trip through the frame read-back (the inline serializer maps them
   * to run properties). Returns false when the caret isn't in a frame, so
   * the mark command falls back to the body path.
   */
  applyFrameMark(tag: string): boolean {
    const frameId = this.editedFrameId();
    if (frameId === null) return false;
    const cmd = MARK_EXEC_COMMAND[tag];
    if (!cmd) return false;
    this.host.ownerDocument.execCommand(cmd);
    // `execCommand` fires `input`, but mark it dirty explicitly so the
    // read-back runs even on engines that don't emit one for formatting.
    this.dirtyFrameIds.add(frameId);
    this.scheduleChange();
    return true;
  }

  /** Active state of `tag` at a frame caret (toolbar highlight), or null
   *  when the caret isn't in a frame. */
  frameMarkActive(tag: string): boolean | null {
    if (this.editedFrameId() === null) return null;
    const cmd = MARK_EXEC_COMMAND[tag];
    return cmd ? this.host.ownerDocument.queryCommandState(cmd) : false;
  }

  /**
   * Schedule a DOM-driven change emit. Called from the `input` listener
   * when the user types — the DOM is the source of truth and we sync the
   * AST from it before notifying listeners.
   */
  private scheduleChange(): void {
    if (this.debounceHandle !== null) window.clearTimeout(this.debounceHandle);
    this.debounceHandle = window.setTimeout(() => {
      this.debounceHandle = null;
      this.ensureCurrent();
      this.emitChangeNow();
    }, this.debounceMs);
  }

  /**
   * Emit a `change` event using the current in-memory AST verbatim. Do
   * NOT sync from DOM — callers that need a DOM sync should call it
   * explicitly (user-typing path does). API mutations have already
   * rendered their AST into the DOM and must not let the lossy DOM-read
   * overwrite properties the renderer doesn't surface
   * (column widths, verticalAlign, table properties, …).
   */
  private emitChangeNow(): void {
    this.revision += 1;
    // Consume the flag here (not only when there are listeners) so a
    // later emit can't inherit a stale `true`.
    const liveFrameEdit = this.pendingLiveFrameEdit;
    this.pendingLiveFrameEdit = false;
    if (!this.events.hasChangeListeners()) return;
    const stripped = stripBinary(this.doc);
    this.events.emitChange({
      doc: stripped,
      // Alias for backwards compat — same reference, no clone cost.
      document: stripped,
      revision: this.revision,
      documentVersion: this.registry.documentVersion(),
      ...(liveFrameEdit ? { liveFrameEdit: true } : {}),
    });
  }

  // === Y.Doc mirroring ===

  /**
   * Snapshot of the live block ids in body order — used both as the
   * input to `applyDocumentToYDoc` (so each Y.Map carries its stable
   * id) and as the `blockIdsArray()` the renderer uses to set the
   * `data-block-id` attribute.
   */
  private allBlockIds(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.registry.length(); i++) {
      out.push(this.registry.refAt(i).id);
    }
    return out;
  }

  /**
   * Mirror the current `this.doc` into the Y.Doc as a single
   * transaction. The diff is performed by `applyDocumentToYDoc`,
   * which matches blocks by id so concurrent edits to *different*
   * blocks merge cleanly via the Y.Array CRDT.
   *
   * Origin is `"local"` so a future Y observer can distinguish locally-
   * driven mutations (already rendered) from remote ones (need re-render).
   */
  private mirrorToYDoc(): void {
    // When a BlobStore is configured, any path that's been migrated
    // to a partRef (or is currently being migrated) must not get
    // mirrored inline — that would re-introduce the bytes into the
    // Y.Doc. Without a BlobStore, the skip set is empty and behavior
    // is identical to today.
    const skip = parts.computePartPathSkipSet(this.ctx);
    applyDocumentToYDoc(
      this.ydoc,
      this.doc,
      this.allBlockIds(),
      "local",
      skip ? { skipPartPaths: skip } : {},
    );
  }

  /**
   * Compose the current selection into a {@link SelectionPayload} and
   * dispatch to subscribers. Called from the document-level
   * `selectionchange` listener attached in the constructor; safe to fire
   * even when no subscribers exist (the early-return keeps it cheap).
   */
  private fireSelection(): void {
    this.events.emitSelection(this.selection.get());
  }

  private fireKeyDown(e: KeyboardEvent): void {
    this.events.emitKeyDown(e);
  }
}

// === helpers ===

/**
 * Strip binary `rawParts` from a document before emitting on the event
 * stream. Keeps the payload JSON-clean for WebSocket/MCP transport.
 */
function stripBinary(doc: SobreeDocument): SobreeDocument {
  return { ...doc, rawParts: {} };
}

// Re-export countBlocks for any callers that need it.
export { countBlocks };
