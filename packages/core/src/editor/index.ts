import "./editor.css";
import * as Y from "yjs";
import { BlobCache, type BlobStore, sha256Hex } from "../blob";
import {
  applyDocumentToYDoc,
  applyPartRefsToYDoc,
  projectYDoc,
  seedYDoc,
  Y_PARTS_KEY,
} from "../ydoc";
import {
  type BlockRef,
  type EditError,
  type EditResult,
  type InlinePosition,
  type Range as ApiRange,
  type Selection,
  fail,
  lockConflict,
  ok,
} from "../doc/api";
import { emptyDocument } from "../doc/builders";
import { pruneOrphanParts } from "../doc/parts";
import {
  type EmbedFontFaces,
  type EmbedFontOptions,
  embedFontIntoDoc,
  removeFontFromDoc,
} from "../fonts";
import {
  type RunPropertiesPatch,
  applyRunPropertiesToRuns,
  mergeAdjacentTextRuns,
  runLength,
  runsLength,
  splitRunsAt,
} from "../doc/runs";
import type {
  Block,
  DrawingRun,
  InlineRun,
  Paragraph,
  ParagraphProperties,
  RevisionMark,
  SobreeDocument,
  Table,
  TableCell,
  TableRow,
} from "../doc/types";
import { BlockRegistry } from "./internal/blockRegistry";
import {
  type Mutation,
  allocateMediaPath,
  mergeParagraphProps,
  mergeSectionsAcross,
  mimeToExtension,
  pxToEmu,
  removedSectionIndex,
  wrapTagToPatch,
} from "./internal/mutations";
import {
  applySelectionToDom,
  blockElementAtIndex,
  countBlocks,
} from "./internal/positionMap";
import { EditorTable } from "./table";
import { renderSobreeDocument } from "./view/docRenderer/index";
import { FontFaceRegistry } from "../fonts";
import { History } from "../history";
import {
  MARK_COMMAND_DEFS,
  isMarkActive,
  rangeAtSelection,
  toggleMark,
} from "../plugins/marks";
import { serializeHostsToDocument } from "./view/docSerialize/index";
import { attachImageResize } from "./view/imageResize";
import { EditorCommands } from "./commands";
import type { EditorContext } from "./context";
import * as comments from "./ops/comments";
import * as query from "./query";
import { EditorSelection } from "./selection";
// EditorSelection + EditorCommands moved to ./selection / ./commands;
// re-exported here so the public surface (and HeadlessSobree) is unchanged.
export { EditorCommands } from "./commands";
export { EditorSelection } from "./selection";
import {
  decideFormatRun,
  decideRevisionRun,
  snapshotFormatRevision,
  stampDeleteRevision,
  stampInsertRevision,
} from "./revisionRuns";
import {
  caretRangeFromPoint,
  closestBlockElement,
  currentDomRangeInsideHosts,
  hasImageInDataTransfer,
  readImageDimensions,
  unwrap,
} from "./dom";

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
          onResolved: (hash) => this.onBlobResolved(hash),
        })
      : null;

    // Two construction paths:
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
      this.resolveCachedPartRefsInto(this.doc);
    }

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

    this.dragOverListener = (e) => this.onDragOver(e);
    host.addEventListener("dragover", this.dragOverListener);

    this.dropListener = (e) => this.onDrop(e);
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
    this.resolveCachedPartRefsInto(this.doc);
    if (this.blobCache) {
      const missing = Object.values(projected.partRefs).filter(
        (h) => !this.blobCache!.has(h),
      );
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
  private resolveCachedPartRefsInto(doc: SobreeDocument): void {
    if (!this.blobCache) return;
    for (const [path, hash] of Object.entries(this.lastPartRefs)) {
      if (doc.rawParts[path]) continue; // inline-parts entry wins if both present
      const bytes = this.blobCache.get(hash);
      if (bytes) doc.rawParts[path] = bytes;
    }
  }

  /**
   * Callback fired by the BlobCache when a background fetch lands.
   * Walks `lastPartRefs` to find which paths reference this hash,
   * patches `this.doc.rawParts`, and re-renders so the user sees
   * the part appear.
   */
  private onBlobResolved(hash: string): void {
    if (!this.blobCache) return;
    let touched = false;
    for (const [path, refHash] of Object.entries(this.lastPartRefs)) {
      if (refHash !== hash) continue;
      const bytes = this.blobCache.get(hash);
      if (bytes && !this.doc.rawParts[path]) {
        this.doc.rawParts[path] = bytes;
        touched = true;
      }
    }
    if (!touched) return;
    // Re-render so the renderer picks up the freshly-resolved part.
    // This is a full re-render; future Phase 3.2.x can scope it to
    // just the affected images / fonts.
    const hosts = this.getContentHosts();
    for (const h of hosts) h.replaceChildren();
    const firstHost = hosts[0] ?? this.host;
    this.fontFaces.sync(this.doc.fonts, this.doc.rawParts);
    renderSobreeDocument(this.doc, firstHost, this.blockIdsArray());
    this.emitChangeNow();
  }

  /**
   * Wait for every currently-referenced binary part to be available
   * in the local cache. Useful before `toDocx()` so the exported
   * file contains all images / fonts.
   *
   * Returns a resolved Promise immediately when no `blobStore` is
   * configured (today's default — bytes are always inline).
   */
  async ensurePartsLoaded(): Promise<void> {
    if (!this.blobCache) return;
    const hashes = Object.values(this.lastPartRefs);
    if (hashes.length === 0) return;
    await this.blobCache.ensureLoaded(hashes);
    // After fetches land, re-resolve into `this.doc`.
    this.resolveCachedPartRefsInto(this.doc);
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
    const hosts = this.getContentHosts();
    for (const h of hosts) h.replaceChildren();
    const firstHost = hosts[0] ?? this.host;
    // Sync `@font-face` registrations BEFORE rendering so newly-embedded
    // fonts are already available to the render pass.
    this.fontFaces.sync(this.doc.fonts, this.doc.rawParts);
    renderSobreeDocument(this.doc, firstHost, this.blockIdsArray());
    this.domDirty = false;
    this.mirrorToYDoc();
    this.emitChangeNow();
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
    const { doc, kept, pruned } = pruneOrphanParts(this.doc);
    if (pruned.length === 0) return { kept, pruned };
    this.doc = doc;
    this.mirrorToYDoc();
    return { kept, pruned };
  }

  /**
   * Embed a TTF/OTF font into the document. Thin wrapper around
   * `embedFontIntoDoc()` from the fonts module — handles the
   * setDocument round so the renderer + `@font-face` registry pick
   * up the new face automatically.
   *
   * Refuses (with a warning) when the font's OS/2 `fsType` field
   * marks it as restricted, unless `opts.allowRestricted` is true.
   * Pass any subset of {regular, bold, italic, boldItalic}; missing
   * faces are simply not embedded.
   */
  embedFont(
    name: string,
    faces: EmbedFontFaces,
    opts: EmbedFontOptions = {},
  ): { warnings: string[] } {
    const before = this.doc.rawParts;
    const result = embedFontIntoDoc(this.doc, name, faces, opts);
    if (result.next !== this.doc) {
      // Diff which part paths the font module just added — they're
      // candidates for migration to the BlobStore (Phase 3.2+).
      const addedPartPaths: Array<{ path: string; bytes: Uint8Array }> = [];
      if (this.blobStore && this.blobCache) {
        for (const [path, bytes] of Object.entries(result.next.rawParts)) {
          if (!before[path]) addedPartPaths.push({ path, bytes });
        }
        for (const { path } of addedPartPaths) {
          this.pendingPartRefMigrations.add(path);
        }
      }
      this.setDocument(result.next);
      // Fire migrations AFTER setDocument so the partPath is
      // already in `lastPartRefs`-adjacent state. Errors are logged
      // inside migratePartToBlobStore.
      for (const { path, bytes } of addedPartPaths) {
        void this.migratePartToBlobStore(path, bytes);
      }
    }
    return { warnings: result.warnings };
  }

  /**
   * Drop a font declaration by name. The associated font parts in
   * `rawParts` aren't immediately removed — call `pruneUnusedParts()`
   * (or just export) to GC them.
   */
  removeEmbeddedFont(name: string): void {
    const next = removeFontFromDoc(this.doc, name);
    if (next !== this.doc) this.setDocument(next);
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
    this.ensureCurrent();
    const lockCheck = this.checkRefs([target]);
    if (lockCheck) return lockCheck;
    const index = this.registry.indexOf(target.id);
    const next = this.doc.body.slice();
    const wasSectionBreak = next[index]?.kind === "section_break";
    next[index] = block;
    // If a SectionBreak was the previous block here and the replacement
    // isn't one, the two sections it separated must merge — there's
    // nothing left to delimit them. The earlier section's properties
    // survive.
    const update: Partial<SobreeDocument> = { body: next };
    if (wasSectionBreak && block.kind !== "section_break") {
      update.sections = mergeSectionsAcross(this.doc.sections, removedSectionIndex(this.doc.body, index));
    }
    return this.commit(update, [{ type: "bump", index }]);
  }

  /**
   * Insert `block` before the target block. Returns the new ref.
   *
   * In track-changes mode (see `setTrackChanges`), if `block` is a
   * paragraph it gets stamped with `revision: { type: "ins", author }`
   * on its properties — the same paragraph-mark semantics as
   * `splitBlock`. Non-paragraph blocks (table, section_break) don't
   * carry the marker in v1 and insert plain.
   */
  insertBlockBefore(target: BlockRef, block: Block): EditResult<BlockRef> {
    this.ensureCurrent();
    const lockCheck = this.checkRefs([target]);
    if (lockCheck) return lockCheck;
    const index = this.registry.indexOf(target.id);
    const stamped = this.stampInsertedBlockIfTracked(block);
    const next = this.doc.body.slice();
    next.splice(index, 0, stamped);
    return this.commit({ body: next }, [{ type: "insert", index }]);
  }

  /**
   * Insert `block` after the target block. Returns the new ref.
   * Tracked-mode behaviour matches `insertBlockBefore`.
   */
  insertBlockAfter(target: BlockRef, block: Block): EditResult<BlockRef> {
    this.ensureCurrent();
    const lockCheck = this.checkRefs([target]);
    if (lockCheck) return lockCheck;
    const index = this.registry.indexOf(target.id);
    const stamped = this.stampInsertedBlockIfTracked(block);
    const next = this.doc.body.slice();
    next.splice(index + 1, 0, stamped);
    return this.commit({ body: next }, [{ type: "insert", index: index + 1 }]);
  }

  /**
   * Delete the target block.
   *
   * In track-changes mode, paragraph blocks aren't removed — their
   * `properties.revision` is stamped `del` (the renderer shows the
   * paragraph mark with a strikethrough ¶ glyph; the body text stays
   * visible). If the paragraph carries the *current author's* pending
   * `ins` marker (a paragraph the user themselves just created), the
   * block is removed outright — cancelling an un-committed insert,
   * matching the inline `deleteRange` semantics. Non-paragraph blocks
   * (tables, section breaks) bypass tracking in v1 — they remove plainly.
   */
  deleteBlock(target: BlockRef): EditResult<void> {
    this.ensureCurrent();
    const lockCheck = this.checkRefs([target]);
    if (lockCheck) return lockCheck;
    const index = this.registry.indexOf(target.id);
    const current = this.doc.body[index];

    if (this.trackChanges.enabled && current?.kind === "paragraph") {
      const existing = current.properties.revision;
      // Cancelling own pending ins → actually remove.
      if (
        existing?.type === "ins" &&
        existing.author === this.trackChanges.author
      ) {
        // fall through to plain remove below
      } else {
        const revision: RevisionMark =
          this.trackChanges.author === undefined
            ? { type: "del" }
            : { type: "del", author: this.trackChanges.author };
        const next = this.doc.body.slice();
        next[index] = {
          ...current,
          properties: { ...current.properties, revision },
        };
        return this.commit({ body: next }, [{ type: "bump", index }]);
      }
    }

    const wasSectionBreak = current?.kind === "section_break";
    const next = this.doc.body.slice();
    next.splice(index, 1);
    if (next.length === 0) next.push({ kind: "paragraph", properties: {}, runs: [] });
    const update: Partial<SobreeDocument> = { body: next };
    if (wasSectionBreak) {
      update.sections = mergeSectionsAcross(this.doc.sections, removedSectionIndex(this.doc.body, index));
    }
    return this.commit(update, [{ type: "remove", index }]);
  }

  /**
   * Stamp `revision: ins` on a paragraph block if tracked mode is on
   * and the block doesn't already carry one. Helper for
   * `insertBlockBefore` / `insertBlockAfter`. Non-paragraph blocks
   * pass through unchanged.
   */
  private stampInsertedBlockIfTracked(block: Block): Block {
    if (!this.trackChanges.enabled) return block;
    if (block.kind !== "paragraph") return block;
    if (block.properties.revision) return block;
    const revision: RevisionMark =
      this.trackChanges.author === undefined
        ? { type: "ins" }
        : { type: "ins", author: this.trackChanges.author };
    return { ...block, properties: { ...block.properties, revision } };
  }

  /** Merge a patch into each target paragraph's properties. */
  applyBlockProperties(
    targets: BlockRef[],
    patch: ParagraphPropertiesPatch,
  ): EditResult<void> {
    this.ensureCurrent();
    const lockCheck = this.checkRefs(targets);
    if (lockCheck) return lockCheck;
    const next = this.doc.body.slice();
    const bumps: Mutation[] = [];
    for (const ref of targets) {
      const index = this.registry.indexOf(ref.id);
      const block = next[index];
      if (!block) continue;
      if (block.kind !== "paragraph") {
        return fail({
          code: "invalid-state",
          details: `block ${ref.id} is not a paragraph`,
        });
      }
      next[index] = { ...block, properties: mergeParagraphProps(block.properties, patch) };
      bumps.push({ type: "bump", index });
    }
    return this.commit({ body: next }, bumps);
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
    this.ensureCurrent();
    const lockCheck = this.checkRange(range, opts.expect);
    if (lockCheck) return lockCheck;
    if (this.trackChanges.enabled) {
      const author = this.trackChanges.author;
      return this.mutateRunsInRange(range, (runs) => {
        const snapshotted = runs.map((r) => snapshotFormatRevision(r, author));
        return applyRunPropertiesToRuns(snapshotted, patch);
      });
    }
    return this.mutateRunsInRange(range, (runs) => applyRunPropertiesToRuns(runs, patch));
  }

  /** Wrap the runs in `range` with semantic formatting. */
  wrapRange(
    range: ApiRange,
    tag: WrapTag,
    opts: { expect?: Record<string, number> } = {},
  ): EditResult<void> {
    return this.applyRunProperties(range, wrapTagToPatch(tag), opts);
  }

  /**
   * Insert a run at `at`. Splits the run list at the offset.
   *
   * In track-changes mode (see `setTrackChanges`), the run is stamped
   * with `revision: { type: "ins", author }` before insertion (unless
   * it already carries a `revision` — caller-provided revisions are
   * never overwritten).
   */
  insertRun(at: InlinePosition, run: InlineRun): EditResult<BlockRef> {
    this.ensureCurrent();
    const lockCheck = this.checkRefs([at.block]);
    if (lockCheck) return lockCheck;
    const index = this.registry.indexOf(at.block.id);
    const block = this.doc.body[index];
    if (!block || block.kind !== "paragraph") {
      return fail({ code: "invalid-position", details: "target is not a paragraph" });
    }
    const stamped = this.trackChanges.enabled
      ? stampInsertRevision(run, this.trackChanges.author)
      : run;
    const { before, after } = splitRunsAt(block.runs, at.offset);
    const merged = mergeAdjacentTextRuns([...before, stamped, ...after]);
    const next = this.doc.body.slice();
    next[index] = { ...block, runs: merged };
    return this.commit({ body: next }, [{ type: "bump", index }]);
  }

  /**
   * Split a paragraph at `at`. The runs before the offset stay on the
   * original block; the runs after move into a fresh paragraph that's
   * inserted immediately after. The new block inherits the original
   * paragraph's properties (alignment, style, indent, …) so the visual
   * shape of the split is what the user expects from pressing Enter.
   *
   * In track-changes mode (see `setTrackChanges`), the new paragraph's
   * `properties.revision` is stamped `{ type: "ins", author }` — the
   * "this paragraph break is a tracked insert" marker. The original
   * paragraph is left clean; only the *new* paragraph carries the mark,
   * mirroring how Word stores `<w:rPr><w:ins/></w:rPr>` inside `<w:pPr>`.
   *
   * `at.offset` is clamped to `[0, block-length]`. A split at offset 0
   * inserts an empty paragraph *before* the cursor; a split at the
   * block's full length inserts an empty paragraph *after*.
   *
   * Returns the ref of the *new* (second) block — callers typically
   * place the caret at its offset 0.
   */
  splitBlock(at: InlinePosition): EditResult<BlockRef> {
    this.ensureCurrent();
    const lockCheck = this.checkRefs([at.block]);
    if (lockCheck) return lockCheck;
    const index = this.registry.indexOf(at.block.id);
    const block = this.doc.body[index];
    if (!block || block.kind !== "paragraph") {
      return fail({ code: "invalid-position", details: "target is not a paragraph" });
    }
    const { before, after } = splitRunsAt(block.runs, at.offset);
    const firstHalf: Paragraph = { ...block, runs: mergeAdjacentTextRuns(before) };
    // Build the new paragraph's properties. Inherit everything from the
    // source; in tracked mode, stamp `revision: ins` on top.
    const newProps: ParagraphProperties = this.trackChanges.enabled
      ? {
          ...block.properties,
          revision:
            this.trackChanges.author === undefined
              ? { type: "ins" }
              : { type: "ins", author: this.trackChanges.author },
        }
      : { ...block.properties };
    const secondHalf: Paragraph = {
      kind: "paragraph",
      properties: newProps,
      runs: mergeAdjacentTextRuns(after),
    };
    const next = this.doc.body.slice();
    next.splice(index, 1, firstHalf, secondHalf);
    const result = this.commit({ body: next }, [
      { type: "bump", index },
      { type: "insert", index: index + 1 },
    ]);
    if (!result.ok) return result;
    // `affected` is `[bumped first half, inserted second half]` in
    // mutation order. Surfacing the new block's ref as `value` lets
    // callers (notably `handleTrackedInput`'s caret placement) consume
    // it without a follow-up `getBlock(index + 1)` round-trip.
    const newRef = result.affected[1] ?? result.affected[0]!;
    return { ok: true, value: newRef, affected: result.affected };
  }

  /**
   * Insert an image at `at`. The bytes are stored in `doc.rawParts` under
   * a fresh `word/media/imageN.{ext}` path; a `DrawingRun` referencing
   * that path is inserted at the position.
   *
   * When a `blobStore` is configured (Phase 3.2+), the bytes also
   * migrate in the background: hashed, uploaded to the store, and a
   * `partRefs[partPath] = hash` entry written to the Y.Doc. Once the
   * migration lands, the Y.Doc's inline `parts[partPath]` is cleared —
   * so the bytes ride the side-channel, not the Y update stream.
   * The local renderer keeps reading `doc.rawParts[partPath]`
   * throughout (the value is stable from the moment `insertImage`
   * returns).
   */
  insertImage(
    at: InlinePosition,
    bytes: Uint8Array,
    opts: { mime: string; widthPx?: number; heightPx?: number; altText?: string },
  ): EditResult<BlockRef> {
    this.ensureCurrent();
    const ext = mimeToExtension(opts.mime);
    const partPath = allocateMediaPath(this.doc, ext);
    this.doc.rawParts[partPath] = bytes;
    // Mark for migration BEFORE the insertRun→commit→mirror chain
    // runs, so the mirror's skip-set catches this path on its first
    // pass and doesn't write inline bytes to Y.Doc.
    if (this.blobStore && this.blobCache) {
      this.pendingPartRefMigrations.add(partPath);
      // Fire-and-forget background migration. Errors are logged inside.
      void this.migratePartToBlobStore(partPath, bytes);
    }
    const widthPx = opts.widthPx ?? 200;
    const heightPx = opts.heightPx ?? 150;
    const drawing: DrawingRun = {
      kind: "drawing",
      partPath,
      widthEmu: pxToEmu(widthPx),
      heightEmu: pxToEmu(heightPx),
      placement: "inline",
    };
    if (opts.altText) drawing.altText = opts.altText;
    return this.insertRun(at, drawing);
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
  deleteRange(
    range: ApiRange,
    opts: { expect?: Record<string, number> } = {},
  ): EditResult<void> {
    this.ensureCurrent();
    const lockCheck = this.checkRange(range, opts.expect);
    if (lockCheck) return lockCheck;
    if (range.from.block.id !== range.to.block.id) {
      return this.trackChanges.enabled
        ? this.deleteRangeAcrossBlocksTracked(range)
        : this.deleteRangeAcrossBlocksPlain(range);
    }
    if (this.trackChanges.enabled) {
      const author = this.trackChanges.author;
      return this.mutateRunsInRange(range, (runs) =>
        runs.flatMap((r) => stampDeleteRevision(r, author)),
      );
    }
    return this.mutateRunsInRange(range, () => []);
  }

  /**
   * Tracked cross-paragraph delete. Walks each paragraph in the range:
   * stamps `del` on the affected runs (first-block tail / intermediate
   * full / last-block head), and on every paragraph *after the first*
   * stamps the paragraph-mark `del` so `acceptAllRevisions` later
   * merges them all into the first block. Single commit.
   */
  private deleteRangeAcrossBlocksTracked(range: ApiRange): EditResult<void> {
    const fromIdx = this.registry.indexOf(range.from.block.id);
    const toIdx = this.registry.indexOf(range.to.block.id);
    if (fromIdx < 0 || toIdx < 0 || fromIdx > toIdx) {
      return fail({ code: "range-out-of-order", details: "range endpoints" });
    }
    const author = this.trackChanges.author;
    const nextBody = this.doc.body.slice();
    const bumps: Mutation[] = [];

    for (let i = fromIdx; i <= toIdx; i++) {
      const block = nextBody[i];
      if (!block || block.kind !== "paragraph") continue;

      // Apply the del-stamp to the right slice of this block's runs.
      let newRuns: InlineRun[];
      if (i === fromIdx) {
        const split = splitRunsAt(block.runs, range.from.offset);
        const tailStamped = split.after.flatMap((r) =>
          stampDeleteRevision(r, author),
        );
        newRuns = mergeAdjacentTextRuns([...split.before, ...tailStamped]);
      } else if (i === toIdx) {
        const split = splitRunsAt(block.runs, range.to.offset);
        const headStamped = split.before.flatMap((r) =>
          stampDeleteRevision(r, author),
        );
        newRuns = mergeAdjacentTextRuns([...headStamped, ...split.after]);
      } else {
        newRuns = mergeAdjacentTextRuns(
          block.runs.flatMap((r) => stampDeleteRevision(r, author)),
        );
      }

      let nextBlock: Paragraph = { ...block, runs: newRuns };

      // Stamp paragraph-mark del on every block AFTER the first — the
      // break between i-1 and i is part of the deletion. Skip if a
      // revision is already present: we don't overwrite peer markers,
      // and own-ins-cancel + del-on-top-of-del don't make sense in
      // a bulk path.
      if (i > fromIdx && !block.properties.revision) {
        const revision: RevisionMark =
          author === undefined ? { type: "del" } : { type: "del", author };
        nextBlock = {
          ...nextBlock,
          properties: { ...nextBlock.properties, revision },
        };
      }

      nextBody[i] = nextBlock;
      bumps.push({ type: "bump", index: i });
    }

    return this.commit({ body: nextBody }, bumps);
  }

  /**
   * Non-tracked cross-paragraph delete. Keeps the head of the first
   * block + the tail of the last block, splices them into the first
   * block as one paragraph, and removes everything in between.
   */
  private deleteRangeAcrossBlocksPlain(range: ApiRange): EditResult<void> {
    const fromIdx = this.registry.indexOf(range.from.block.id);
    const toIdx = this.registry.indexOf(range.to.block.id);
    if (fromIdx < 0 || toIdx < 0 || fromIdx > toIdx) {
      return fail({ code: "range-out-of-order", details: "range endpoints" });
    }
    const first = this.doc.body[fromIdx];
    const last = this.doc.body[toIdx];
    if (!first || first.kind !== "paragraph" || !last || last.kind !== "paragraph") {
      return fail({ code: "invalid-state", details: "cross-block delete requires paragraph endpoints" });
    }
    const head = splitRunsAt(first.runs, range.from.offset).before;
    const tail = splitRunsAt(last.runs, range.to.offset).after;
    const merged = mergeAdjacentTextRuns([...head, ...tail]);

    const nextBody = this.doc.body.slice();
    nextBody[fromIdx] = { ...first, runs: merged };
    // Remove blocks (fromIdx+1) .. toIdx — that many entries.
    nextBody.splice(fromIdx + 1, toIdx - fromIdx);
    if (nextBody.length === 0) {
      nextBody.push({ kind: "paragraph", properties: {}, runs: [] });
    }

    const mutations: Mutation[] = [{ type: "bump", index: fromIdx }];
    // Top-down removes so each index stays valid as we shrink the array.
    for (let i = toIdx; i > fromIdx; i--) {
      mutations.push({ type: "remove", index: i });
    }
    return this.commit({ body: nextBody }, mutations);
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
      this.trackChanges.enabled === state.enabled &&
      this.trackChanges.author === state.author;
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
        if (
          this.trackChanges.enabled &&
          sel.kind === "caret" &&
          sel.at.offset === 0
        ) {
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
    this.ensureCurrent();
    const lockCheck = this.checkRange(range, opts.expect);
    if (lockCheck) return lockCheck;
    return this.mutateRunsInRange(range, (runs) =>
      runs.flatMap((r) => decideRevisionRun(r, "accept")),
    );
  }

  /**
   * Reject the tracked changes inside `range`: insertions are removed
   * (the inserted text is dropped), deletions are restored (the
   * revision marker is stripped, deleted text kept). The inverse of
   * `acceptRevision`.
   */
  rejectRevision(
    range: ApiRange,
    opts: { expect?: Record<string, number> } = {},
  ): EditResult<void> {
    this.ensureCurrent();
    const lockCheck = this.checkRange(range, opts.expect);
    if (lockCheck) return lockCheck;
    return this.mutateRunsInRange(range, (runs) =>
      runs.flatMap((r) => decideRevisionRun(r, "reject")),
    );
  }

  /**
   * Accept tracked format changes inside `range`: each text run with a
   * `revisionFormat` snapshot drops the snapshot; the current
   * `properties` stay. Runs without one pass through.
   */
  acceptFormatRevision(
    range: ApiRange,
    opts: { expect?: Record<string, number> } = {},
  ): EditResult<void> {
    this.ensureCurrent();
    const lockCheck = this.checkRange(range, opts.expect);
    if (lockCheck) return lockCheck;
    return this.mutateRunsInRange(range, (runs) =>
      runs.map((r) => decideFormatRun(r, "accept")),
    );
  }

  /**
   * Reject tracked format changes inside `range`: each run reverts its
   * `properties` to `revisionFormat.before`. Inverse of
   * `acceptFormatRevision`.
   */
  rejectFormatRevision(
    range: ApiRange,
    opts: { expect?: Record<string, number> } = {},
  ): EditResult<void> {
    this.ensureCurrent();
    const lockCheck = this.checkRange(range, opts.expect);
    if (lockCheck) return lockCheck;
    return this.mutateRunsInRange(range, (runs) =>
      runs.map((r) => decideFormatRun(r, "reject")),
    );
  }

  /**
   * Accept the paragraph-mark revision on `target`.
   *
   * Per the semantics in `ParagraphProperties.revision`'s docblock:
   *   - `ins` → strip the marker; the paragraph break stays permanent.
   *   - `del` → merge this paragraph's content into the *previous*
   *     paragraph; the paragraph break is consumed.
   *
   * Returns `range-empty`-coded failure if the block has no paragraph
   * revision, and `invalid-state` if a `del` accept would require
   * merging with a non-paragraph (table, section break) — those merges
   * aren't well-defined yet.
   */
  acceptParagraphRevision(target: BlockRef): EditResult<void> {
    this.ensureCurrent();
    const lockCheck = this.checkRefs([target]);
    if (lockCheck) return lockCheck;
    const index = this.registry.indexOf(target.id);
    const block = this.doc.body[index];
    if (!block || block.kind !== "paragraph") {
      return fail({ code: "invalid-position", details: "target is not a paragraph" });
    }
    const rev = block.properties.revision;
    if (!rev) {
      return fail({ code: "range-empty", details: "no paragraph-level revision to accept" });
    }
    if (rev.type === "ins") {
      const { revision: _strip, ...rest } = block.properties;
      const next = this.doc.body.slice();
      next[index] = { ...block, properties: rest };
      return this.commit({ body: next }, [{ type: "bump", index }]);
    }
    // del → merge into previous paragraph (the break is consumed).
    return this.mergeWithPrevious(index);
  }

  /**
   * Reject the paragraph-mark revision on `target`.
   *   - `ins` → merge this paragraph into the *previous* one (the split
   *     introduced by the tracked Enter is undone).
   *   - `del` → strip the marker; the paragraph break stays.
   */
  rejectParagraphRevision(target: BlockRef): EditResult<void> {
    this.ensureCurrent();
    const lockCheck = this.checkRefs([target]);
    if (lockCheck) return lockCheck;
    const index = this.registry.indexOf(target.id);
    const block = this.doc.body[index];
    if (!block || block.kind !== "paragraph") {
      return fail({ code: "invalid-position", details: "target is not a paragraph" });
    }
    const rev = block.properties.revision;
    if (!rev) {
      return fail({ code: "range-empty", details: "no paragraph-level revision to reject" });
    }
    if (rev.type === "del") {
      const { revision: _strip, ...rest } = block.properties;
      const next = this.doc.body.slice();
      next[index] = { ...block, properties: rest };
      return this.commit({ body: next }, [{ type: "bump", index }]);
    }
    // ins → undo the split: merge into previous paragraph.
    return this.mergeWithPrevious(index);
  }

  /**
   * Concatenate `body[index]`'s runs onto the end of `body[index-1]`
   * and remove `body[index]`. The previous block must be a paragraph;
   * otherwise we bail with `invalid-state`. Used by accept/reject of
   * paragraph-mark revisions where the decision means "this paragraph
   * break should not exist".
   */
  private mergeWithPrevious(index: number): EditResult<void> {
    if (index <= 0) {
      // No previous block — the paragraph break before index 0 is
      // implicit (start-of-doc), so a `del` marker there is
      // semantically nonsensical. Strip it instead of leaving the
      // block in a half-state where the marker says "delete this
      // break" but nothing happens — the dock then thinks the
      // revision is still unresolved and the user can't progress.
      return this.stripParagraphMarker(index);
    }
    const prev = this.doc.body[index - 1];
    const cur = this.doc.body[index];
    if (!prev || !cur || cur.kind !== "paragraph") {
      return fail({ code: "invalid-state", details: "current block is not a paragraph" });
    }
    if (prev.kind !== "paragraph") {
      return fail({
        code: "invalid-state",
        details: "previous block is not a paragraph — cross-kind merge unsupported",
      });
    }
    const next = this.doc.body.slice();
    next[index - 1] = {
      ...prev,
      runs: mergeAdjacentTextRuns([...prev.runs, ...cur.runs]),
    };
    next.splice(index, 1);
    if (next.length === 0) next.push({ kind: "paragraph", properties: {}, runs: [] });
    return this.commit({ body: next }, [
      { type: "bump", index: index - 1 },
      { type: "remove", index },
    ]);
  }

  /**
   * Strip the `revision` marker from `body[index]`'s paragraph
   * properties, leaving the block (and its content) in place.
   * Fallback for merge-impossible cases — see `mergeWithPrevious`'s
   * `index <= 0` branch and `applyAllRevisions`' second pass.
   */
  private stripParagraphMarker(index: number): EditResult<void> {
    const block = this.doc.body[index];
    if (!block || block.kind !== "paragraph") {
      return fail({ code: "invalid-position", details: "target is not a paragraph" });
    }
    if (!block.properties.revision) return ok<void>(undefined as void, []);
    const { revision: _strip, ...rest } = block.properties;
    const next = this.doc.body.slice();
    next[index] = { ...block, properties: rest };
    return this.commit({ body: next }, [{ type: "bump", index }]);
  }

  /**
   * Flag `body[index]`'s paragraph break as a tracked deletion —
   * stamp `properties.revision = { type: "del", author }`. Used by
   * `handleTrackedInput` for the Backspace-at-start-of-paragraph
   * keystroke.
   *
   * Two short-circuits:
   *   - If the paragraph already carries the *same author's* pending
   *     `ins` (the user is backspacing into a split they themselves
   *     just made), drop the marker and merge into the previous
   *     paragraph — cancelling an un-committed insert rather than
   *     layering del on top of ins.
   *   - If the paragraph carries some OTHER revision (peer's ins, an
   *     existing del), leave it alone with a no-op success. The
   *     reviewer should resolve those via accept/reject first.
   */
  private markParagraphBreakForDelete(index: number): EditResult<void> {
    const block = this.doc.body[index];
    if (!block || block.kind !== "paragraph") {
      return fail({ code: "invalid-position", details: "target is not a paragraph" });
    }
    const author = this.trackChanges.author;
    const existing = block.properties.revision;
    if (existing?.type === "ins" && existing.author === author) {
      // Own pending split — cancel it by merging back into previous.
      return this.mergeWithPrevious(index);
    }
    if (existing) {
      // Peer's revision — leave it alone.
      return ok<void>(undefined as void, []);
    }
    const revision: RevisionMark =
      author === undefined ? { type: "del" } : { type: "del", author };
    const next = this.doc.body.slice();
    next[index] = {
      ...block,
      properties: { ...block.properties, revision },
    };
    return this.commit({ body: next }, [{ type: "bump", index }]);
  }

  /**
   * Enumerate every logical tracked change in the document.
   *
   * Consecutive revision-bearing runs by the same author coalesce into
   * one `RevisionSpan` — so a delete-then-insert replacement is one
   * span, and two unrelated insertions in a paragraph (separated by
   * plain text) are two. Each span's `range` carries fresh, versioned
   * `BlockRef`s, ready to hand to `acceptRevision` / `rejectRevision`.
   *
   * Call after each `change` — the ranges are positional, so re-query
   * rather than caching across edits.
   */
  getRevisions(): RevisionSpan[] {
    this.ensureCurrent();
    const spans: RevisionSpan[] = [];
    for (let i = 0; i < this.doc.body.length; i++) {
      const block = this.doc.body[i];
      if (!block) continue;
      if (block.kind === "table") {
        // Walk into table cells. Cell paragraphs aren't tracked in
        // the registry (they don't have stable BlockRefs), so we
        // surface their revisions under the *containing table's*
        // BlockRef as a sentinel. The dock count + `acceptAllRevisions`
        // see them; per-cell single-accept via the popover isn't
        // supported yet (requires the registry to know about cell
        // paragraphs — a separate refactor).
        const info = this.getBlock(i);
        const tableRef: BlockRef = { id: info.id, version: info.version };
        for (const row of block.rows) {
          for (const cell of row.cells) {
            for (const inner of cell.content) {
              if (inner.kind !== "paragraph") continue;
              this.collectParagraphRevisions(inner, tableRef, spans);
            }
          }
        }
        continue;
      }
      if (block.kind !== "paragraph") continue;
      const info = this.getBlock(i);
      const ref: BlockRef = { id: info.id, version: info.version };
      // Paragraph-mark revision (level: "paragraph"). Surface it first
      // so review UIs see one entry per block, ordered with inline
      // revisions to follow.
      const pRev = block.properties.revision;
      if (pRev) {
        spans.push({
          range: {
            from: { block: ref, offset: 0 },
            to: { block: ref, offset: info.length },
          },
          ...(pRev.author !== undefined ? { author: pRev.author } : {}),
          kinds: [pRev.type],
          ...(pRev.date !== undefined ? { date: pRev.date } : {}),
          level: "paragraph",
        });
      }
      let offset = 0;
      let open: {
        start: number;
        end: number;
        author: string | undefined;
        kinds: Set<"ins" | "del">;
        date: string | undefined;
      } | null = null;
      // Parallel walker for format-change spans — same coalescing rule
      // (same author, contiguous). Format spans don't have ins/del
      // kinds; we use a synthetic `kinds: ["ins"]` (with `level:
      // "format"`) so the consumer shape stays uniform.
      let openFmt: {
        start: number;
        end: number;
        author: string | undefined;
        date: string | undefined;
      } | null = null;
      const flushFmt = (): void => {
        if (!openFmt) return;
        spans.push({
          range: {
            from: { block: ref, offset: openFmt.start },
            to: { block: ref, offset: openFmt.end },
          },
          ...(openFmt.author !== undefined ? { author: openFmt.author } : {}),
          kinds: ["ins"],
          ...(openFmt.date !== undefined ? { date: openFmt.date } : {}),
          level: "format",
        });
        openFmt = null;
      };
      const flush = (): void => {
        if (!open) return;
        spans.push({
          range: {
            from: { block: ref, offset: open.start },
            to: { block: ref, offset: open.end },
          },
          ...(open.author !== undefined ? { author: open.author } : {}),
          kinds: [...open.kinds],
          ...(open.date !== undefined ? { date: open.date } : {}),
          level: "inline",
        });
        open = null;
      };
      for (const run of block.runs) {
        const len = runLength(run);
        const rev = run.kind === "text" ? run.properties.revision : undefined;
        if (rev) {
          // Coalesce into the open span when the author matches (both
          // `undefined` counts as a match — anonymous revisions group).
          if (open && open.author === rev.author) {
            open.end = offset + len;
            open.kinds.add(rev.type);
          } else {
            flush();
            open = {
              start: offset,
              end: offset + len,
              author: rev.author,
              kinds: new Set<"ins" | "del">([rev.type]),
              date: rev.date,
            };
          }
        } else {
          flush();
        }
        // Format-revision walker — independent of ins/del so a run can
        // be both (e.g. inserted text whose subsequent format was
        // tracked-changed).
        const rf = run.kind === "text" ? run.properties.revisionFormat : undefined;
        if (rf) {
          if (openFmt && openFmt.author === rf.author) {
            openFmt.end = offset + len;
          } else {
            flushFmt();
            openFmt = {
              start: offset,
              end: offset + len,
              author: rf.author,
              date: rf.date,
            };
          }
        } else {
          flushFmt();
        }
        offset += len;
      }
      flush();
      flushFmt();
    }
    return spans;
  }

  /**
   * Walk one paragraph and append its revision spans to `out`. Used by
   * `getRevisions` for both top-level paragraphs (where `ref` is the
   * paragraph's own BlockRef) and for paragraphs inside table cells
   * (where `ref` is the *containing table's* BlockRef as a sentinel —
   * cell paragraphs don't have their own registry entry yet).
   *
   * Emits the same three-level span shape as the inline walker:
   * paragraph-mark first, then coalesced inline ins/del spans, then
   * coalesced format-change spans.
   */
  private collectParagraphRevisions(
    block: Paragraph,
    ref: BlockRef,
    out: RevisionSpan[],
  ): void {
    const length = runsLength(block.runs);

    // Paragraph-mark
    const pRev = block.properties.revision;
    if (pRev) {
      out.push({
        range: {
          from: { block: ref, offset: 0 },
          to: { block: ref, offset: length },
        },
        ...(pRev.author !== undefined ? { author: pRev.author } : {}),
        kinds: [pRev.type],
        ...(pRev.date !== undefined ? { date: pRev.date } : {}),
        level: "paragraph",
      });
    }

    // Inline + format walkers — same logic as in `getRevisions`'s
    // top-level loop. Kept inline (rather than calling the loop)
    // because the loop manages its own open/openFmt state machines.
    let offset = 0;
    let open: {
      start: number; end: number;
      author: string | undefined;
      kinds: Set<"ins" | "del">;
      date: string | undefined;
    } | null = null;
    let openFmt: {
      start: number; end: number;
      author: string | undefined;
      date: string | undefined;
    } | null = null;
    const flush = (): void => {
      if (!open) return;
      out.push({
        range: {
          from: { block: ref, offset: open.start },
          to: { block: ref, offset: open.end },
        },
        ...(open.author !== undefined ? { author: open.author } : {}),
        kinds: [...open.kinds],
        ...(open.date !== undefined ? { date: open.date } : {}),
        level: "inline",
      });
      open = null;
    };
    const flushFmt = (): void => {
      if (!openFmt) return;
      out.push({
        range: {
          from: { block: ref, offset: openFmt.start },
          to: { block: ref, offset: openFmt.end },
        },
        ...(openFmt.author !== undefined ? { author: openFmt.author } : {}),
        kinds: ["ins"],
        ...(openFmt.date !== undefined ? { date: openFmt.date } : {}),
        level: "format",
      });
      openFmt = null;
    };
    for (const run of block.runs) {
      const len = runLength(run);
      const rev = run.kind === "text" ? run.properties.revision : undefined;
      if (rev) {
        if (open && open.author === rev.author) {
          open.end = offset + len;
          open.kinds.add(rev.type);
        } else {
          flush();
          open = {
            start: offset, end: offset + len,
            author: rev.author,
            kinds: new Set<"ins" | "del">([rev.type]),
            date: rev.date,
          };
        }
      } else {
        flush();
      }
      const rf = run.kind === "text" ? run.properties.revisionFormat : undefined;
      if (rf) {
        if (openFmt && openFmt.author === rf.author) {
          openFmt.end = offset + len;
        } else {
          flushFmt();
          openFmt = { start: offset, end: offset + len, author: rf.author, date: rf.date };
        }
      } else {
        flushFmt();
      }
      offset += len;
    }
    flush();
    flushFmt();
  }

  /**
   * Accept every tracked change in the document. With `opts.author`,
   * accept only that author's changes. One commit for the whole sweep.
   */
  acceptAllRevisions(opts: { author?: string } = {}): EditResult<void> {
    return this.applyAllRevisions("accept", opts.author);
  }

  /** Reject every tracked change (optionally filtered by author). */
  rejectAllRevisions(opts: { author?: string } = {}): EditResult<void> {
    return this.applyAllRevisions("reject", opts.author);
  }

  private applyAllRevisions(
    decision: "accept" | "reject",
    author: string | undefined,
  ): EditResult<void> {
    this.ensureCurrent();
    // Two passes:
    //   1. Inline revisions on every paragraph's runs (existing path).
    //   2. Paragraph-mark revisions — collected as a list of "merge with
    //      previous" actions, applied bottom-up so the indices stay valid
    //      as paragraphs collapse.
    const nextBody = this.doc.body.slice();
    const bumps: Mutation[] = [];
    const removes: number[] = [];

    for (let i = 0; i < nextBody.length; i++) {
      const block = nextBody[i];
      if (!block) continue;
      // Tables: sweep their cell paragraphs too. We process inline +
      // format + paragraph-mark *within* each cell, but `merge with
      // previous` for a cell paragraph-mark del falls back to
      // strip-the-marker (merging across cell paragraph boundaries
      // requires structural cell-content edits we keep separate).
      if (block.kind === "table") {
        const tableChanged = this.sweepTableCellRevisions(block, decision, author);
        if (tableChanged.changed) {
          nextBody[i] = tableChanged.next;
          bumps.push({ type: "bump", index: i });
        }
        continue;
      }
      if (block.kind !== "paragraph") continue;

      let changed = false;
      const newRuns = block.runs.flatMap((r) => {
        let next: InlineRun = r;
        // Inline ins/del revision.
        const rev = r.kind === "text" ? r.properties.revision : undefined;
        if (rev && (author === undefined || rev.author === author)) {
          const decided = decideRevisionRun(next, decision);
          changed = true;
          // `decideRevisionRun` may return [] (drop) or a single run.
          if (decided.length === 0) return decided;
          next = decided[0]!;
        }
        // Format-change revision (rPrChange).
        const rf = next.kind === "text" ? next.properties.revisionFormat : undefined;
        if (rf && (author === undefined || rf.author === author)) {
          next = decideFormatRun(next, decision);
          changed = true;
        }
        return [next];
      });
      let nextBlock: Block = block;
      if (changed) {
        nextBlock = { ...block, runs: mergeAdjacentTextRuns(newRuns) };
      }

      // Paragraph-mark revision on this block.
      const pRev = block.properties.revision;
      if (pRev && (author === undefined || pRev.author === author)) {
        // "Strip the marker" — accept-ins / reject-del — keeps the
        // paragraph split, just clears the mark.
        // "Merge with previous" — accept-del / reject-ins — collapses
        // this paragraph into the previous one.
        const stripMarker =
          (decision === "accept" && pRev.type === "ins") ||
          (decision === "reject" && pRev.type === "del");
        if (stripMarker) {
          const { revision: _strip, ...rest } = (nextBlock as Paragraph).properties;
          nextBlock = { ...(nextBlock as Paragraph), properties: rest };
          changed = true;
        } else {
          // Schedule a merge — defer to second pass.
          removes.push(i);
          // Still apply the inline changes for this block first.
          if (changed) nextBody[i] = nextBlock;
          continue;
        }
      }

      if (changed) {
        nextBody[i] = nextBlock;
        bumps.push({ type: "bump", index: i });
      }
    }

    // Second pass — apply paragraph-mark merges bottom-up so indices
    // stay valid as paragraphs collapse. For merge-impossible cases
    // (first block, or previous block is a non-paragraph), strip the
    // marker as a best-effort fallback: the user asked us to resolve
    // all revisions, so leaving a marker in place defeats the intent
    // and traps the reviewer in the dock with "unresolved" items they
    // can't actually act on.
    if (removes.length > 0) {
      removes.sort((a, b) => b - a);
      for (const i of removes) {
        const cur = nextBody[i];
        if (!cur || cur.kind !== "paragraph") continue;
        const prev = i > 0 ? nextBody[i - 1] : null;
        const canMerge = prev != null && prev.kind === "paragraph";
        if (!canMerge) {
          // Strip the marker rather than no-op the merge.
          if (cur.properties.revision) {
            const { revision: _strip, ...rest } = cur.properties;
            nextBody[i] = { ...cur, properties: rest };
            bumps.push({ type: "bump", index: i });
          }
          continue;
        }
        nextBody[i - 1] = {
          ...prev,
          runs: mergeAdjacentTextRuns([...prev.runs, ...cur.runs]),
        };
        nextBody.splice(i, 1);
        bumps.push({ type: "bump", index: i - 1 });
        bumps.push({ type: "remove", index: i });
      }
      if (nextBody.length === 0) nextBody.push({ kind: "paragraph", properties: {}, runs: [] });
    }

    if (bumps.length === 0) return ok<void>(undefined as void, []);
    return this.commit({ body: nextBody }, bumps);
  }

  /**
   * Walk a table's cell paragraphs and apply the accept/reject
   * decision to inline + format + paragraph-mark revisions inside.
   * Returns `{ next, changed }` so the caller knows whether to bump
   * the table block. Paragraph-mark del within a cell falls back to
   * strip-the-marker rather than attempting a cross-cell-paragraph
   * merge — that structural edit is out of v1 scope for tables.
   */
  private sweepTableCellRevisions(
    table: Table,
    decision: "accept" | "reject",
    author: string | undefined,
  ): { next: Table; changed: boolean } {
    let anyChanged = false;
    const nextRows = table.rows.map((row: TableRow): TableRow => ({
      ...row,
      cells: row.cells.map((cell: TableCell): TableCell => {
        let cellChanged = false;
        const nextContent: Block[] = cell.content.map((inner: Block): Block => {
          if (inner.kind !== "paragraph") return inner;
          let pChanged = false;
          const newRuns = inner.runs.flatMap((r) => {
            let next: InlineRun = r;
            const rev = r.kind === "text" ? r.properties.revision : undefined;
            if (rev && (author === undefined || rev.author === author)) {
              const decided = decideRevisionRun(next, decision);
              pChanged = true;
              if (decided.length === 0) return decided;
              next = decided[0]!;
            }
            const rf = next.kind === "text" ? next.properties.revisionFormat : undefined;
            if (rf && (author === undefined || rf.author === author)) {
              next = decideFormatRun(next, decision);
              pChanged = true;
            }
            return [next];
          });
          let nextPara: Paragraph = pChanged
            ? { ...inner, runs: mergeAdjacentTextRuns(newRuns) }
            : inner;
          // Paragraph-mark — strip-as-fallback only. v1 doesn't merge
          // cell paragraphs across boundaries.
          const pRev = inner.properties.revision;
          if (pRev && (author === undefined || pRev.author === author)) {
            const { revision: _strip, ...rest } = nextPara.properties;
            nextPara = { ...nextPara, properties: rest };
            pChanged = true;
          }
          if (pChanged) {
            cellChanged = true;
            anyChanged = true;
          }
          return nextPara;
        });
        if (!cellChanged) return cell;
        return { ...cell, content: nextContent };
      }),
    }));
    return { next: anyChanged ? { ...table, rows: nextRows } : table, changed: anyChanged };
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
    const pos = this.selection.currentCaret();
    if (!pos) return fail({ code: "invalid-position", details: "no selection" });
    return this.insertImage(pos, bytes, opts);
  }

  /**
   * Unwrap span ancestors intersecting the selection, up to the block.
   * Best-effort DOM-level cleanup — preserves the current in-place UX
   * without re-rendering.
   */
  clearInlineFormattingAtSelection(): void {
    const range = currentDomRangeInsideHosts(this.getContentHosts());
    if (!range) return;
    const block = closestBlockElement(range.startContainer, this.getContentHosts());
    if (!block) return;
    const spans: HTMLSpanElement[] = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) =>
        n instanceof HTMLSpanElement && range.intersectsNode(n)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP,
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) spans.push(n as HTMLSpanElement);
    for (const span of spans) unwrap(span);
    this.scheduleChange();
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
   * Apply a runs transform to the runs covered by `range`. Returns
   * `EditResult<void>`. Handles both single- and multi-block ranges.
   * Assumes locks have already been checked.
   */
  private mutateRunsInRange(
    range: ApiRange,
    transform: (runs: InlineRun[]) => InlineRun[],
  ): EditResult<void> {
    const fromIdx = this.registry.indexOf(range.from.block.id);
    const toIdx = this.registry.indexOf(range.to.block.id);
    if (fromIdx < 0 || toIdx < 0 || fromIdx > toIdx) {
      return fail({ code: "range-out-of-order", details: "range endpoints" });
    }
    const nextBody = this.doc.body.slice();
    const bumps: Mutation[] = [];

    if (fromIdx === toIdx) {
      const block = nextBody[fromIdx];
      if (!block || block.kind !== "paragraph") {
        return fail({ code: "invalid-state", details: `block ${range.from.block.id} not a paragraph` });
      }
      if (range.from.offset === range.to.offset) {
        return fail({ code: "range-empty", details: "zero-width range" });
      }
      const headSplit = splitRunsAt(block.runs, range.from.offset);
      const tailSplit = splitRunsAt(headSplit.after, range.to.offset - range.from.offset);
      const middle = transform(tailSplit.before);
      const merged = mergeAdjacentTextRuns([...headSplit.before, ...middle, ...tailSplit.after]);
      nextBody[fromIdx] = { ...block, runs: merged };
      bumps.push({ type: "bump", index: fromIdx });
    } else {
      // Multi-block range: first block's tail, all of middle blocks,
      // last block's head get transformed.
      for (let i = fromIdx; i <= toIdx; i++) {
        const block = nextBody[i];
        if (!block || block.kind !== "paragraph") continue;
        let newRuns: InlineRun[];
        if (i === fromIdx) {
          const split = splitRunsAt(block.runs, range.from.offset);
          newRuns = mergeAdjacentTextRuns([...split.before, ...transform(split.after)]);
        } else if (i === toIdx) {
          const split = splitRunsAt(block.runs, range.to.offset);
          newRuns = mergeAdjacentTextRuns([...transform(split.before), ...split.after]);
        } else {
          newRuns = mergeAdjacentTextRuns(transform(block.runs));
        }
        nextBody[i] = { ...block, runs: newRuns };
        bumps.push({ type: "bump", index: i });
      }
    }
    return this.commit({ body: nextBody }, bumps);
  }

  /**
   * Apply a mutation to `this.doc`, update the registry, re-render, fire
   * change. Returns the affected refs (post-bump).
   */
  private commit<T = void>(
    update: Partial<SobreeDocument>,
    mutations: readonly Mutation[],
    value?: T,
    _reason: string = "commit",
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
    const skip = this.computePartPathSkipSet();
    applyDocumentToYDoc(
      this.ydoc,
      this.doc,
      this.allBlockIds(),
      "local",
      skip ? { skipPartPaths: skip } : {},
    );
  }

  /**
   * Returns the set of part paths that mirror should NOT write
   * inline — they're (or will soon be) tracked via the partRefs
   * Y.Map instead. Returns `undefined` when there's nothing to skip
   * (the common no-BlobStore case) so the mirror takes its
   * fastest path.
   */
  private computePartPathSkipSet(): ReadonlySet<string> | undefined {
    if (this.pendingPartRefMigrations.size === 0) {
      const refKeys = Object.keys(this.lastPartRefs);
      if (refKeys.length === 0) return undefined;
      return new Set(refKeys);
    }
    const out = new Set<string>(Object.keys(this.lastPartRefs));
    for (const p of this.pendingPartRefMigrations) out.add(p);
    return out;
  }

  /**
   * Background migrate inline part bytes into the BlobStore. Called
   * by mutators (`insertImage`, `embedFont`) when a `BlobStore` is
   * configured. The local `doc.rawParts` keeps its inline copy so
   * the renderer stays synchronous; the Y.Doc gets a `partRefs`
   * entry referencing the BlobStore content hash, and any stale
   * `parts` entry is deleted.
   *
   * Robust against errors: an upload failure logs and leaves the
   * path in the pending set so a future call can retry. The local
   * renderer is unaffected (bytes are still in `doc.rawParts`).
   */
  private async migratePartToBlobStore(
    partPath: string,
    bytes: Uint8Array,
  ): Promise<void> {
    if (!this.blobStore || !this.blobCache) return;
    this.pendingPartRefMigrations.add(partPath);
    try {
      const hash = await sha256Hex(bytes);
      this.blobCache.put(hash, bytes);
      await this.blobStore.put(bytes);
      this.ydoc.transact(() => {
        // Write the partRef (the new authoritative reference).
        applyPartRefsToYDoc(this.ydoc, { [partPath]: hash }, "local");
        // Delete any stale inline parts entry. The mirror's skip set
        // will prevent re-introducing it.
        this.ydoc.getMap<Uint8Array>(Y_PARTS_KEY).delete(partPath);
      }, "local");
      this.lastPartRefs = { ...this.lastPartRefs, [partPath]: hash };
    } catch (err) {
      console.error(
        `[sobree] failed to migrate part ${partPath} to BlobStore:`,
        err,
      );
    } finally {
      this.pendingPartRefMigrations.delete(partPath);
    }
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

  private onDragOver(e: DragEvent): void {
    if (!hasImageInDataTransfer(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }

  private async onDrop(e: DragEvent): Promise<void> {
    if (!hasImageInDataTransfer(e.dataTransfer)) return;
    e.preventDefault();
    const dropRange = caretRangeFromPoint(e.clientX, e.clientY);
    if (dropRange) {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(dropRange);
      }
    }
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
      f.type.startsWith("image/"),
    );
    for (const file of files) await this.insertImageFromFile(file);
  }

  private async insertImageFromFile(file: File): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const dims = await readImageDimensions(file);
    this.insertImageAtSelection(bytes, {
      mime: file.type || "image/png",
      widthPx: dims.width,
      heightPx: dims.height,
      altText: file.name,
    });
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
