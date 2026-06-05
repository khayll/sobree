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
import { MARK_COMMAND_DEFS, isMarkActive, rangeAtSelection, toggleMark } from "../plugins/marks";
import { applyDocumentToYDoc, projectYDoc, seedYDoc } from "../ydoc";
import { EditorCommands } from "./commands";
import type { EditorContext } from "./context";
import { BlockRegistry } from "./internal/blockRegistry";
import type { Mutation } from "./internal/mutations";
import { applySelectionToDom, blockElementAtIndex, countBlocks } from "./internal/positionMap";
import * as blocks from "./ops/blocks";
import * as comments from "./ops/comments";
import * as parts from "./ops/parts";
import * as review from "./ops/review";
import * as runs from "./ops/runs";
import * as query from "./query";
import { EditorSelection } from "./selection";
import { EditorTable } from "./table";
import { renderSobreeDocument } from "./view/docRenderer/index";
import { serializeHostsToDocument } from "./view/docSerialize/index";
import { attachImageResize } from "./view/imageResize";
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
  OutlineItem,
  ParagraphPropertiesPatch,
  RevisionSpan,
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
  OutlineItem,
  ParagraphPropertiesPatch,
  RevisionSpan,
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
  /** Listener that re-projects + re-renders on remote Y.Doc updates.
   *  Removed on `destroy()`. */
  private ydocUpdateListener: ((tr: Y.Transaction) => void) | null = null;
  private doc: SobreeDocument;
  private readonly registry: BlockRegistry;
  private readonly debounceMs: number;
  private readonly getContentHosts: () => HTMLElement[];
  private debounceHandle: number | null = null;
  private detachImageResize: (() => void) | null = null;
  private inputListener: ((e: Event) => void) | null = null;
  private beforeInputListener: ((e: Event) => void) | null = null;
  private pasteListener: ((e: ClipboardEvent) => void) | null = null;
  private dragOverListener: ((e: DragEvent) => void) | null = null;
  private dropListener: ((e: DragEvent) => void) | null = null;
  private revision = 0;
  private readonly listeners: {
    change: Set<(p: ChangePayload) => void>;
    selection: Set<(p: SelectionPayload) => void>;
    keydown: Set<(p: KeyDownPayload) => void>;
    "track-changes-change": Set<(p: TrackChangesState) => void>;
  } = {
    change: new Set(),
    selection: new Set(),
    keydown: new Set(),
    "track-changes-change": new Set(),
  };
  /**
   * Authoring mode for revisions. Off by default — mutations apply
   * plainly. On, `insertRun` / `deleteRange` route through
   * `applyTrackChangesToInsert` / `applyTrackChangesToDelete`. See the
   * `TrackChangesState` type docblock for the full semantics.
   */
  private trackChanges: TrackChangesState = { enabled: false };
  /**
   * One-shot warning set for tracked-mode beforeinput types we don't
   * (yet) route through the API — paragraph splits, paste, IME, etc.
   * We let the browser handle them untracked rather than swallowing
   * the keystroke, but log the inputType the first time we see it so
   * the gap is visible during development.
   */
  private trackedInputWarned = new Set<string>();
  /**
   * Active IME composition state (`compositionstart` → `compositionend`).
   * `null` outside composition or in non-tracked mode.
   *
   * Snapshot-then-restore is the only practical way to track IME-typed
   * text: we can't intercept `beforeinput` during composition without
   * breaking input methods on most platforms, so we let the browser
   * mutate the DOM natively during composition, then on `compositionend`
   * we roll back to the pre-composition AST and re-insert the final
   * composed string (`event.data`) through `insertRun` — which stamps
   * the `revision: ins` marker per `TrackChangesState`.
   */
  private composition: {
    /** AST snapshot taken at `compositionstart`. */
    snapshot: SobreeDocument;
    /** Caret position at `compositionstart`, used as the insertion point. */
    caret: InlinePosition | null;
  } | null = null;
  private compositionStartListener: ((e: CompositionEvent) => void) | null = null;
  private compositionEndListener: ((e: CompositionEvent) => void) | null = null;
  /** Document-level `selectionchange` listener. Funnels every cursor
   *  movement (typing, click, arrows, programmatic restore) into the
   *  `selection` event so plugins don't each register their own. */
  private selectionChangeListener: (() => void) | null = null;
  /** Host-level `keydown` listener. Funnels every key press into the
   *  `keydown` event for plugins (mark shortcuts, navigation, etc.). */
  private keydownListener: ((e: KeyboardEvent) => void) | null = null;
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

    // Two construction paths (run after the context exists so the adopt
    // path can resolve cached part refs through it):
    //
    //   A. The provided Y.Doc is empty (or none was provided): seed it
    //      from `initialDocument` (or the empty doc). This is the v0.1
    //      default — solo embedder, no provider yet.
    //
    //   B. The provided Y.Doc has body content already: adopt its
    //      state instead of seeding. This is the "peer joined an
    //      active room" scenario — Phase 2's providers populate the
    //      Y.Doc *before* the Editor is constructed, and we trust
    //      whatever's there.
    const ydocBody = this.ydoc.getArray<Y.Map<unknown>>("body");
    if (ydocBody.length === 0) {
      // Path A: seed.
      this.doc = options.initialDocument ?? emptyDocument();
      this.registry.reset(this.doc.body.length);
      this.lastSerialisedBlocks = this.doc.body.map((b) => JSON.stringify(b));
      seedYDoc(this.ydoc, this.doc, this.allBlockIds());
      this.lastPartRefs = {};
    } else {
      // Path B: adopt.
      const projected = projectYDoc(this.ydoc);
      this.doc = projected.doc;
      this.registry.adoptIds(projected.ids);
      this.lastSerialisedBlocks = this.doc.body.map((b) => JSON.stringify(b));
      this.lastPartRefs = projected.partRefs;
      parts.resolveCachedPartRefsInto(this.ctx, this.doc);
    }

    // `history.undo` / `history.redo` registered on the command bus
    // here (NOT in the keyboard plugin) so a headless caller — agent,
    // toolbar without keyboard mounted, MCP — can dispatch undo/redo
    // through the same surface as Cmd+Z. The keyboard plugin only maps
    // the keystroke → execute call.
    this.commands.register({
      name: "history.undo",
      title: "Undo",
      run: () => {
        this.history.undo();
      },
      isActive: () => false,
      isAvailable: () => this.history.canUndo(),
    });
    this.commands.register({
      name: "history.redo",
      title: "Redo",
      run: () => {
        this.history.redo();
      },
      isActive: () => false,
      isAvailable: () => this.history.canRedo(),
    });

    // Mark toggles — same rationale as history commands. Registered in
    // core (not in the keyboard plugin) so disabling keyboard doesn't
    // wipe the toolbar's bold / italic / etc. dispatch path.
    for (const { name, title, tag } of MARK_COMMAND_DEFS) {
      this.commands.register({
        name,
        title,
        run: () => {
          const range = rangeAtSelection(this);
          if (range) toggleMark(this, range, tag);
        },
        isActive: () => {
          const range = rangeAtSelection(this);
          return !!range && isMarkActive(this, range, tag);
        },
        isAvailable: () => this.getBlocks().length > 0,
      });
    }

    host.classList.add("sobree-editor");
    host.contentEditable = "true";
    host.setAttribute("role", "textbox");
    host.setAttribute("aria-multiline", "true");
    host.spellcheck = true;

    const firstHost = this.getContentHosts()[0] ?? host;
    this.fontFaces.sync(this.doc.fonts, this.doc.rawParts);
    renderSobreeDocument(this.doc, firstHost, this.blockIdsArray());

    this.inputListener = () => {
      // Mark DOM dirty + schedule a change; mirroring into the Y.Doc
      // happens inside the debounced sync path. Y.UndoManager
      // observes the resulting Y operations and creates stack items
      // automatically (coalesced via `captureTimeout` — typing within
      // ~1s merges into one undo step).
      this.domDirty = true;
      this.scheduleChange();
    };
    host.addEventListener("input", this.inputListener);
    // beforeinput is the only place we get the chance to intercept
    // the browser's native contentEditable undo/redo
    // (`historyUndo` / `historyRedo`) and route them through our own
    // history layer — otherwise the browser would mutate the DOM in a
    // way that desyncs from the Y.Doc.
    this.beforeInputListener = (e) => {
      const ie = e as InputEvent;
      if (ie.inputType === "historyUndo") {
        e.preventDefault();
        this.history.undo();
        return;
      }
      if (ie.inputType === "historyRedo") {
        e.preventDefault();
        this.history.redo();
        return;
      }
      // Track-changes authoring path: in tracked mode, the handful of
      // edits we know how to convert into `insertRun` / `deleteRange`
      // get routed through the typed API so the resulting runs carry
      // revision markers. Unhandled inputTypes (Enter, paste, IME, …)
      // fall through to the browser's native contenteditable behaviour
      // — untracked, with a one-shot console warning so the dev sees
      // the gap. See `handleTrackedInput` for the full menu.
      //
      // We *also* take over when tracked mode is OFF but the caret
      // sits inside a revision wrapper (an `<ins>`/`<del>` left over
      // from earlier tracked typing). Without this, the browser's
      // contenteditable insert path puts the new character INSIDE the
      // wrapper, the post-input DOM read sees text inside `<ins>`,
      // and `syncFromDom` stamps the new run as `revision: ins` —
      // tracking edits the user explicitly opted *out* of tracking.
      // Routing through `handleTrackedInput` instead places the new
      // run as a separate AST node next to the wrapper; differing
      // `revision` properties block `mergeAdjacentTextRuns`, so the
      // new plain run stays plain.
      const inTracked = this.trackChanges.enabled;
      const inRevisionWrapper = !inTracked && this.caretInsideRevisionWrapper();
      if ((inTracked || inRevisionWrapper) && this.handleTrackedInput(ie)) {
        e.preventDefault();
        return;
      }
      // Any other inputType is a real edit; let the browser handle
      // the DOM mutation. The input listener will catch the change
      // afterwards.
    };
    host.addEventListener("beforeinput", this.beforeInputListener);

    // IME composition — see `this.composition`'s docblock. Listeners
    // are unconditional but the work only happens when tracked mode
    // was on at `compositionstart`.
    this.compositionStartListener = (e) => this.handleCompositionStart(e);
    this.compositionEndListener = (e) => this.handleCompositionEnd(e);
    host.addEventListener("compositionstart", this.compositionStartListener);
    host.addEventListener("compositionend", this.compositionEndListener);

    // One global `selectionchange` listener funnels all cursor movement
    // into the editor's `selection` event. Plugins subscribe to the
    // editor instead of fighting over the document-level event.
    this.selectionChangeListener = () => this.fireSelection();
    document.addEventListener("selectionchange", this.selectionChangeListener);

    // Host-scoped `keydown` listener — fires the editor's `keydown`
    // event for plugins. The editor binds no shortcuts itself.
    this.keydownListener = (e) => this.fireKeyDown(e);
    host.addEventListener("keydown", this.keydownListener);

    this.pasteListener = (e) => this.onPaste(e);
    host.addEventListener("paste", this.pasteListener);

    this.dragOverListener = (e) => runs.onDragOver(this.ctx, e);
    host.addEventListener("dragover", this.dragOverListener);

    this.dropListener = (e) => void runs.onDrop(this.ctx, e);
    host.addEventListener("drop", this.dropListener);

    this.detachImageResize = attachImageResize(host);

    // Subscribe to *remote*-origin Y.Doc updates — i.e., updates that
    // came in from a provider (Phase 2: WebSocket peer, IndexedDB
    // restore, WebRTC, …) rather than from this Editor's own
    // mutations. Local mutations carry origin `"local"` (set by
    // `mirrorToYDoc()`) and the seed pass carries `"seed"`; we skip
    // both since the AST is already current. Anything else is remote
    // and we re-project + re-render.
    this.ydocUpdateListener = (tr: Y.Transaction) => {
      if (tr.origin === "local" || tr.origin === "seed") return;
      this.adoptYDocState();
    };
    this.ydoc.on("afterTransaction", this.ydocUpdateListener);
  }

  /**
   * Assemble the {@link EditorContext} the behaviour modules operate on.
   * Closes over `this` so the kernel methods (`commit`, `checkRefs`, …)
   * stay private to the class while modules get a curated surface.
   */
  private buildContext(): EditorContext {
    // biome-ignore lint/complexity/noThisInStatic: closure over the instance.
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
    for (const cb of this.listeners["track-changes-change"]) {
      try {
        cb({ ...this.trackChanges });
      } catch (err) {
        console.error("[editor] track-changes-change listener threw:", err);
      }
    }
  }

  /**
   * Route a tracked-mode `beforeinput` event through the typed API so
   * the resulting runs carry revision markers. Returns `true` if the
   * event was consumed (caller should `preventDefault`), `false` to
   * let the browser handle it natively (untracked).
   *
   * **Handled inputTypes** (the 95% case — typing and deleting text):
   *
   *   - `insertText`, `insertReplacementText` — typed characters,
   *     dictation / autocomplete replacements.
   *   - `deleteContentBackward`, `deleteContentForward` — Backspace
   *     and Delete keys, including over a selection.
   *   - `deleteWordBackward`, `deleteWordForward` — Option-Backspace
   *     style word deletions; the browser collapses to the right
   *     selection range before firing, we just delete it.
   *   - `deleteByCut` — Cmd-X. The clipboard side has already been
   *     populated by the browser; we mark the source range deleted.
   *
   * **Unhandled** (return `false`, fall through, warn-once):
   *
   *   - `insertParagraph` / `insertLineBreak` — block split / soft
   *     break. Word tracks these as `<w:ins>` on the paragraph mark;
   *     the corresponding AST mutation (split-block as a tracked op)
   *     hasn't landed yet.
   *   - `insertFromPaste` — paste is handled at the `paste` event level
   *     in `onPaste` (not here), where tracked-mode plain-text paste is
   *     already routed through `insertRun` / `splitBlock`. Rich-paste
   *     (HTML) in tracked mode falls back to plain text by design.
   *   - `insertCompositionText` — handled separately via
   *     `compositionstart` / `compositionend` listeners
   *     (`handleCompositionStart` / `handleCompositionEnd`). We let the
   *     IME render natively during composition, then on end we restore
   *     the pre-composition AST and re-insert the final composed string
   *     through this `insertRun` path.
   *
   * Falling through means the keystroke still works (no broken UX in
   * tracked mode), it just doesn't get a revision marker. The console
   * warning makes the gap visible.
   *
   * Caret restoration: after every routed mutation we set the model
   * selection to where the caret would have ended up on the equivalent
   * direct-edit operation. Because tracked-mode `deleteRange` leaves
   * the runs in place (marked `del`), offsets don't shift — caret math
   * is straightforward.
   */
  private handleTrackedInput(ie: InputEvent): boolean {
    const sel = this.selection.get();
    if (!sel) return false;

    switch (ie.inputType) {
      case "insertText":
      case "insertReplacementText": {
        const text = ie.data ?? "";
        if (!text) return false;
        const insertAt = this.markedRangeForReplace(sel);
        if (!insertAt) return false;
        const run: InlineRun = { kind: "text", text, properties: {} };
        const result = this.insertRun(insertAt, run);
        if (!result.ok) return true; // consumed but failed — don't fall through
        this.placeCaret(insertAt.block.id, insertAt.offset + text.length);
        return true;
      }
      case "deleteContentBackward":
      case "deleteWordBackward": {
        // Special case: caret at offset 0 of a paragraph in tracked
        // mode. Conceptually the user wants to "delete the paragraph
        // break before this paragraph" — i.e. merge this paragraph
        // into the previous one. Stamp the current paragraph's
        // properties.revision = del so accept merges them; reject
        // strips the marker and the split stays. Mirrors how Word
        // surfaces this keystroke as a tracked block-level edit.
        //
        // If the paragraph already carries the current author's own
        // pending `ins` (a paragraph break THEY just created in
        // tracked mode), we drop the marker outright — cancelling
        // their own un-committed split rather than layering del on
        // top of ins. Same intuition as the inline "own ins" cancel
        // path in `stampDeleteRevision`.
        if (this.trackChanges.enabled && sel.kind === "caret" && sel.at.offset === 0) {
          const idx = this.registry.indexOf(sel.at.block.id);
          if (idx > 0) {
            const result = this.markParagraphBreakForDelete(idx);
            if (!result.ok) return true;
            // Caret stays at offset 0 of this block — the paragraph
            // hasn't been removed yet, just flagged.
            this.placeCaret(sel.at.block.id, 0);
            return true;
          }
          // At block 0 — no preceding break to delete. Fall through;
          // the browser's no-op is the right behaviour.
        }

        const target = this.rangeForBackwardDelete(sel, ie.inputType);
        if (!target) return false;
        const result = this.deleteRange(target);
        if (!result.ok) return true;
        this.placeCaret(target.from.block.id, target.from.offset);
        return true;
      }
      case "deleteContentForward":
      case "deleteWordForward": {
        const target = this.rangeForForwardDelete(sel, ie.inputType);
        if (!target) return false;
        const result = this.deleteRange(target);
        if (!result.ok) return true;
        this.placeCaret(target.from.block.id, target.from.offset);
        return true;
      }
      case "deleteByCut": {
        if (sel.kind !== "range") return false;
        const result = this.deleteRange(sel.range);
        if (!result.ok) return true;
        this.placeCaret(sel.range.from.block.id, sel.range.from.offset);
        return true;
      }
      case "insertParagraph": {
        // Enter — split the current paragraph at the caret (replacing
        // any selected range first, matching browser semantics).
        const at = this.markedRangeForReplace(sel);
        if (!at) return false;
        const result = this.splitBlock(at);
        if (!result.ok) return true;
        // result.value is the BlockRef of the new (second) paragraph;
        // caret goes to offset 0 there.
        this.placeCaret(result.value.id, 0);
        return true;
      }
      case "insertLineBreak": {
        // Shift+Enter — insert a soft `<br>` BreakRun. In tracked mode
        // it carries `revision: ins` directly on its properties.
        const at = this.markedRangeForReplace(sel);
        if (!at) return false;
        const breakRun: InlineRun = {
          kind: "break",
          type: "line",
          properties: {
            revision:
              this.trackChanges.author === undefined
                ? { type: "ins" }
                : { type: "ins", author: this.trackChanges.author },
          },
        };
        const result = this.insertRun(at, breakRun);
        if (!result.ok) return true;
        // BreakRun has length 1 — caret moves one past the break.
        this.placeCaret(at.block.id, at.offset + 1);
        return true;
      }
      default:
        if (!this.trackedInputWarned.has(ie.inputType)) {
          this.trackedInputWarned.add(ie.inputType);
          console.warn(
            `[editor] track-changes: inputType "${ie.inputType}" not yet routed through the API — falling through to the browser (this edit will be untracked). Phase B follow-up.`,
          );
        }
        return false;
    }
  }

  /**
   * Snapshot the pre-composition AST + caret so `handleCompositionEnd`
   * can roll back the browser's native IME mutations and re-insert the
   * final composed string through the tracked-mode `insertRun`. No-op
   * when tracked mode is off — IME falls through to the browser as
   * always (untracked, but functional).
   */
  private handleCompositionStart(_e: CompositionEvent): void {
    if (!this.trackChanges.enabled) {
      this.composition = null;
      return;
    }
    // `this.doc` is immutable per-commit; capturing the reference is a
    // cheap O(1) snapshot. The browser's DOM mutations during the
    // composition will set `domDirty = true` via the `input` listener,
    // which we'll undo by re-rendering from this snapshot at end.
    this.composition = {
      snapshot: this.doc,
      caret: this.selection.currentCaret(),
    };
  }

  /**
   * Commit a tracked IME composition. Restores the AST to its
   * pre-composition snapshot, re-renders, then inserts `event.data`
   * through `insertRun` at the captured caret — so the final composed
   * string lands as a tracked `ins` instead of as plain text from the
   * browser's native IME commit.
   *
   * Bails out (and clears state) if tracked mode was toggled off
   * mid-composition or the snapshot is missing; the browser's native
   * commit then stands as-is (untracked, but functional).
   */
  private handleCompositionEnd(e: CompositionEvent): void {
    const state = this.composition;
    this.composition = null;
    if (!state || !state.caret) return;
    const text = e.data ?? "";

    // Roll back to the pre-composition AST. We can't trust the DOM
    // state because the IME may have written intermediate composition
    // text that won't be there after this returns — better to re-render
    // from the snapshot and then perform a clean tracked insert.
    this.doc = state.snapshot;
    this.lastSerialisedBlocks = state.snapshot.body.map((b) => JSON.stringify(b));
    this.domDirty = false;
    const hosts = this.getContentHosts();
    for (const h of hosts) h.replaceChildren();
    const firstHost = hosts[0] ?? this.host;
    renderSobreeDocument(this.doc, firstHost, this.blockIdsArray());

    // Empty composition — user cancelled / IME committed nothing.
    // Restore the caret and stop here.
    if (text === "") {
      this.selection.set({ kind: "caret", at: state.caret });
      return;
    }

    // Look up a fresh block ref after the re-render (the registry
    // versions haven't changed since the snapshot, but `getBlockById`
    // is the canonical way and keeps this resilient to future changes
    // in commit semantics).
    const info = this.getBlockById(state.caret.block.id);
    if (!info) return;
    const at: InlinePosition = {
      block: { id: info.id, version: info.version },
      offset: state.caret.offset,
    };
    // Restore the caret first so any side-effect that reads selection
    // sees the right place.
    this.selection.set({ kind: "caret", at });
    const result = this.insertRun(at, { kind: "text", text, properties: {} });
    if (result.ok) {
      this.placeCaret(info.id, at.offset + text.length);
    }
  }

  /**
   * Resolve the position to insert at when the user types over the
   * current selection. For a caret, that's the caret itself; for a
   * range, we delete the range first (which in tracked mode marks the
   * runs `del` but keeps them in place — so the `from` offset is still
   * the right insertion point afterwards). Returns `null` if the
   * selection spans blocks or the delete failed.
   */
  private markedRangeForReplace(sel: Selection): InlinePosition | null {
    if (!sel) return null;
    if (sel.kind === "caret") {
      return this.refreshedPosition(sel.at);
    }
    if (sel.range.from.block.id !== sel.range.to.block.id) return null;
    const del = this.deleteRange(sel.range);
    if (!del.ok) return null;
    return this.refreshedPosition(sel.range.from);
  }

  /**
   * Range a Backspace-style key should delete. Range-selection wins
   * if there is one (just delete the selection). Otherwise step one
   * character left of the caret — at offset 0 we have nothing to do
   * (and Word does nothing in that position too, in v1; cross-block
   * backspace is a follow-up).
   */
  private rangeForBackwardDelete(
    sel: Selection,
    _kind: "deleteContentBackward" | "deleteWordBackward",
  ): ApiRange | null {
    if (!sel) return null;
    if (sel.kind === "range") return sel.range;
    if (sel.at.offset === 0) return null;
    // v1: word-backward still deletes a single char. The browser would
    // hand us a wider range via getTargetRanges() but we'd then need
    // to map DOM ranges back to ApiRanges — kept simple for now.
    const at = this.refreshedPosition(sel.at);
    if (!at) return null;
    return {
      from: { block: at.block, offset: at.offset - 1 },
      to: at,
    };
  }

  /** Forward-delete equivalent of `rangeForBackwardDelete`. */
  private rangeForForwardDelete(
    sel: Selection,
    _kind: "deleteContentForward" | "deleteWordForward",
  ): ApiRange | null {
    if (!sel) return null;
    if (sel.kind === "range") return sel.range;
    const at = this.refreshedPosition(sel.at);
    if (!at) return null;
    const info = this.getBlockById(at.block.id);
    if (!info || at.offset >= info.length) return null;
    return {
      from: at,
      to: { block: at.block, offset: at.offset + 1 },
    };
  }

  /** Re-lookup the block by id to get a fresh `BlockRef` (current version). */
  private refreshedPosition(at: InlinePosition): InlinePosition | null {
    return query.refreshedPosition(this.ctx, at);
  }

  /** Place the caret at `(blockId, offset)` using a fresh block ref. */
  private placeCaret(blockId: string, offset: number): void {
    query.placeCaret(this.ctx, blockId, offset);
  }

  /**
   * True when the current DOM selection's caret sits inside an `<ins>`,
   * `<del>`, or `<span.sobree-revision-format>` wrapper — the markup
   * the renderer emits for tracked revisions. Used by `beforeinput` in
   * mode-off to detect when we have to take over the insert path: if
   * we don't, the browser's contenteditable inserts the new character
   * INSIDE the wrapper and the post-input DOM-sync stamps it with the
   * wrapper's revision marker (an edit the user explicitly opted out
   * of tracking).
   *
   * Returns `false` for a normal caret in plain text, in a `<strong>`
   * / `<em>` / etc. — those wrappers *should* inherit (formatting),
   * unlike revision wrappers which encode "edit history."
   */
  private caretInsideRevisionWrapper(): boolean {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    const { startContainer } = range;

    const el =
      startContainer.nodeType === Node.ELEMENT_NODE
        ? (startContainer as Element)
        : startContainer.parentElement;
    if (!el) return false;

    // Aggressive but reliable: any caret position in a block that
    // contains *any* revision wrapper triggers the intercept. We
    // started with a tighter "caret is inside / adjacent to a
    // wrapper" check, but the browser's contentEditable inheritance
    // rule fires in too many caret configurations to predict — text
    // nodes at the boundary, element-typed startContainers, the
    // moment after a re-render, etc. Intercepting at block scope
    // means the next character lands as a separate AST run no
    // matter where in the block the caret happens to be, and
    // `mergeAdjacentTextRuns` keeps the AST clean by coalescing
    // adjacent runs that share properties.
    //
    // Perf cost: every insert in a partially-tracked block goes
    // through `insertRun` instead of native contentEditable. That's
    // a sync commit + re-render per keystroke; modern browsers
    // handle thousands of these per second, so even a doc with many
    // tracked paragraphs types smoothly. Plain text in *untouched*
    // blocks stays on the fast browser path.
    const block = el.closest<HTMLElement>("[data-block-id]");
    if (!block) return false;
    return !!block.querySelector(
      "ins.sobree-revision, del.sobree-revision, span.sobree-revision-format",
    );
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

  private markParagraphBreakForDelete(index: number): EditResult<void> {
    return review.markParagraphBreakForDelete(this.ctx, index);
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
    const set = this.listeners[event] as Set<(p: EditorEventPayload[E]) => void>;
    set.add(cb);
    return () => set.delete(cb);
  }

  destroy(): void {
    if (this.debounceHandle !== null) {
      window.clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    for (const [evt, listener] of [
      ["input", this.inputListener] as const,
      ["beforeinput", this.beforeInputListener] as const,
      ["paste", this.pasteListener] as const,
      ["dragover", this.dragOverListener] as const,
      ["drop", this.dropListener] as const,
      ["compositionstart", this.compositionStartListener] as const,
      ["compositionend", this.compositionEndListener] as const,
    ]) {
      if (listener) this.host.removeEventListener(evt, listener as EventListener);
    }
    this.inputListener =
      this.beforeInputListener =
      this.pasteListener =
      this.dragOverListener =
      this.dropListener =
      this.compositionStartListener =
      this.compositionEndListener =
        null;
    this.composition = null;
    if (this.selectionChangeListener) {
      document.removeEventListener("selectionchange", this.selectionChangeListener);
      this.selectionChangeListener = null;
    }
    if (this.keydownListener) {
      this.host.removeEventListener("keydown", this.keydownListener);
      this.keydownListener = null;
    }
    this.detachImageResize?.();
    this.detachImageResize = null;
    if (this.ydocUpdateListener) {
      this.ydoc.off("afterTransaction", this.ydocUpdateListener);
      this.ydocUpdateListener = null;
    }
    this.fontFaces.destroy();
    this.history.destroy();
    for (const h of this.getContentHosts()) h.replaceChildren();
    this.host.removeAttribute("contenteditable");
    this.host.classList.remove("sobree-editor");
    this.listeners.change.clear();
    this.listeners.selection.clear();
    this.listeners.keydown.clear();
    this.listeners["track-changes-change"].clear();
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
    if (!this.domDirty) return this.doc;
    return this.syncFromDom();
  }

  private syncFromDom(): SobreeDocument {
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
    this.mirrorToYDoc();
    return this.doc;
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
    if (this.listeners.change.size === 0) return;
    const stripped = stripBinary(this.doc);
    const payload: ChangePayload = {
      doc: stripped,
      // Alias for backwards compat — same reference, no clone cost.
      document: stripped,
      revision: this.revision,
      documentVersion: this.registry.documentVersion(),
    };
    for (const cb of this.listeners.change) {
      try {
        cb(payload);
      } catch (err) {
        console.error("[sobree] change listener threw:", err);
      }
    }
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
    if (this.listeners.selection.size === 0) return;
    const sel = this.selection.get();
    let range: ApiRange | null = null;
    let caret: InlinePosition | null = null;
    if (sel) {
      if (sel.kind === "range") {
        range = sel.range;
        caret = sel.range.from;
      } else {
        caret = sel.at;
      }
    }
    const payload: SelectionPayload = {
      selection: sel,
      range,
      caret,
      block: caret?.block ?? null,
    };
    for (const cb of this.listeners.selection) {
      try {
        cb(payload);
      } catch (err) {
        console.error("[sobree] selection listener threw:", err);
      }
    }
  }

  /**
   * Normalise a DOM `KeyboardEvent` into a {@link KeyDownPayload} and
   * dispatch to subscribers in registration order. Subscribers can
   * `preventDefault()` (browser default) and / or `stopPropagation()`
   * (further subscribers). The editor itself binds no shortcuts —
   * everything goes through plugins.
   */
  private fireKeyDown(e: KeyboardEvent): void {
    if (this.listeners.keydown.size === 0) return;
    let stopped = false;
    const payload: KeyDownPayload = {
      key: e.key.length === 1 ? e.key.toLowerCase() : e.key,
      code: e.code,
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
      meta: e.metaKey,
      preventDefault: () => e.preventDefault(),
      stopPropagation: () => {
        stopped = true;
      },
      originalEvent: e,
    };
    for (const cb of this.listeners.keydown) {
      if (stopped) break;
      try {
        cb(payload);
      } catch (err) {
        console.error("[sobree] keydown listener threw:", err);
      }
    }
  }

  // === clipboard / drag-drop image insertion ===

  private async onPaste(e: ClipboardEvent): Promise<void> {
    const items = e.clipboardData?.items;
    if (!items) return;

    // Image-file paste — handled the same way in tracked and untracked
    // modes; image-as-revision is a follow-up (would need to extend
    // `stampInsertRevision` to drawing runs).
    for (const item of Array.from(items)) {
      if (item.kind !== "file") continue;
      if (!item.type.startsWith("image/")) continue;
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;
      await this.insertImageFromFile(file);
      return;
    }

    // Tracked-mode text paste — intercept so the inserted runs flow
    // through `insertRun` (which stamps `revision: ins` per
    // `TrackChangesState`'s semantics) instead of the browser's native
    // contentEditable paste, which mutates the DOM directly and the
    // post-input sync would land plain runs with no marker.
    //
    // v1 scope: plain text only (`text/plain`). Multi-line text uses
    // `splitBlock` between lines — each line becomes a tracked paragraph
    // (the splits themselves carry `revision: ins` on the new
    // paragraphs' properties, matching the live-typed Enter path).
    // HTML / rich paste in tracked mode falls back to plain-text — a
    // deliberate trade-off so the marker contract stays tight.
    if (this.trackChanges.enabled) {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text === "") return;
      e.preventDefault();
      this.pasteTrackedText(text);
    }
  }

  /**
   * Insert `text` at the current selection in track-changes mode, with
   * each `\n` becoming a `splitBlock`. Used by `onPaste` for plain-text
   * paste; could be reused for tracked drop (a follow-up). Splits the
   * line list once up-front and walks it so each insertRun lands at the
   * caret of the *current* paragraph (which may be a fresh one from a
   * preceding splitBlock).
   */
  private pasteTrackedText(text: string): void {
    const sel = this.selection.get();
    // Replace any selection first (same as live-typing path).
    const insertAt = this.markedRangeForReplace(sel);
    if (!insertAt) return;
    // Normalise CRLF/CR → LF so the line walk is uniform.
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    let pos: InlinePosition | null = insertAt;
    let lastInsertedLength = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line !== "" && pos) {
        const r = this.insertRun(pos, { kind: "text", text: line, properties: {} });
        if (!r.ok) return;
        lastInsertedLength = line.length;
      } else {
        lastInsertedLength = 0;
      }
      // For every line *except* the last, split — produces the next
      // paragraph (whose properties carry `revision: ins`).
      if (i < lines.length - 1 && pos) {
        const afterInsert = this.refreshedPosition({
          block: pos.block,
          offset: pos.offset + lastInsertedLength,
        });
        if (!afterInsert) return;
        const split = this.splitBlock(afterInsert);
        if (!split.ok) return;
        pos = { block: split.value, offset: 0 };
      } else {
        pos = pos
          ? this.refreshedPosition({
              block: pos.block,
              offset: pos.offset + lastInsertedLength,
            })
          : null;
      }
    }
    // Final caret restoration — past the last inserted character.
    if (pos) this.placeCaret(pos.block.id, pos.offset);
  }

  private insertImageFromFile(file: File): Promise<void> {
    return runs.insertImageFromFile(this.ctx, file);
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
