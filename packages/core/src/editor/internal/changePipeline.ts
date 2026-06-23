/**
 * The change / sync pipeline — the kernel transaction loop the `Editor`
 * facade and the behaviour modules (`ops/*`, `query`) drive through the
 * {@link EditorContext} seam.
 *
 * It owns the mutable bookkeeping for the render → mirror → emit cycle:
 *   - `revision` (the change counter) + the debounce handle;
 *   - `lastSerialisedBlocks` (per-block JSON cache for diff-based version
 *     bumps) + the `domDirty` flag;
 *   - `pendingLiveFrameEdit` (a pure live-frame keystroke, so the host can
 *     skip the overlay repaint that would clobber the caret).
 *
 * Everything else — the document cache, registry, hosts, fonts, Y.Doc —
 * is reached through the context. Frame read-back is delegated to the
 * {@link FrameController}; the `change` event goes out through the shared
 * {@link EditorEvents}. Splitting this out keeps `Editor` a thin facade
 * (public API + lifecycle) over a cohesive state machine.
 */

import { type BlockRef, type EditResult, ok } from "../../doc/api";
import type { Block, SobreeDocument } from "../../doc/types";
import { applyDocumentToYDoc, projectYDoc } from "../../ydoc";
import type { EditorContext } from "../context";
import type { EditorEvents } from "../events";
import * as parts from "../ops/parts";
import { renderSobreeDocument } from "../view/docRenderer/index";
import { serializeHostsWithSources } from "../view/docSerialize/index";
import type { FrameController } from "./frames";
import type { Mutation } from "./mutations";
import { applySelectionToDom } from "./positionMap";
import { mergeReadbackBlocks } from "./readbackMerge";

export class ChangePipeline {
  private revision = 0;
  private debounceHandle: number | null = null;
  /** Cached last-seen per-block JSON strings, for diff-based version bumps. */
  private lastSerialisedBlocks: string[] = [];
  /**
   * True when DOM mutations since the last sync were user-driven (typing,
   * paste, drag-drop image). False right after we render from AST — the
   * DOM is then a projection of the doc, and reading it back can't tell us
   * anything the AST doesn't already know, while losing any fidelity the
   * serializer drops (column widths, vAlign, …). `getDocument` and
   * `emitChangeNow` sync only when this flag is set.
   */
  private domDirty = false;
  /**
   * Set by `syncFromDom` when the pending change was a pure live frame
   * keystroke; read (and reset) by `emitChangeNow` into the change
   * payload's `liveFrameEdit`. Lets the host skip the overlay repaint
   * that would clobber the caret, while still repainting on undo/remote.
   */
  private pendingLiveFrameEdit = false;

  constructor(
    private readonly ctx: EditorContext,
    private readonly events: EditorEvents,
    private readonly frames: FrameController,
    private readonly debounceMs: number,
  ) {}

  // === lifecycle / accessors ===

  /** Monotonic counter bumped on each `change` event. */
  getRevision(): number {
    return this.revision;
  }

  /** Mark the body DOM dirty (user typed in body flow). */
  markBodyDirty(): void {
    this.domDirty = true;
  }

  setDomDirty(value: boolean): void {
    this.domDirty = value;
  }

  /**
   * Seed `lastSerialisedBlocks` from `doc` (no dirty flip). Called from the
   * Editor's document-init path, which owns `doc`/registry setup directly.
   */
  captureBaseline(doc: SobreeDocument): void {
    this.lastSerialisedBlocks = doc.body.map((b) => JSON.stringify(b));
  }

  /** Cancel any pending debounced change (teardown). */
  cancelPending(): void {
    if (this.debounceHandle !== null) {
      window.clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
  }

  // === transaction pipeline ===

  /**
   * Apply a mutation to the doc, update the registry, re-render, fire
   * change. Returns the affected refs (post-bump).
   */
  commit<T = void>(
    update: Partial<SobreeDocument>,
    mutations: readonly Mutation[],
    value?: T,
    _reason = "commit",
  ): EditResult<T> {
    const savedSelection = this.ctx.selection.get();

    // Phase 1b.6: Y.UndoManager auto-tracks the resulting Y operations
    // via origin "local" (set by `mirrorToYDoc`). No explicit
    // pre-commit recording needed.

    const next: SobreeDocument = { ...this.ctx.doc, ...update };

    // Apply registry mutations first so `affected` reports new versions.
    const affected: BlockRef[] = [];
    for (const m of mutations) {
      if (m.type === "insert") affected.push(this.ctx.registry.insert(m.index));
      else if (m.type === "remove") this.ctx.registry.remove(m.index);
      else if (m.type === "bump") affected.push(this.ctx.registry.bump(m.index));
    }

    this.ctx.setDoc(next);
    this.lastSerialisedBlocks = next.body.map((b) => JSON.stringify(b));
    const hosts = this.ctx.getContentHosts();
    for (const h of hosts) h.replaceChildren();
    const firstHost = hosts[0] ?? this.ctx.host;
    renderSobreeDocument(this.ctx.doc, firstHost, this.blockIdsArray());

    // Best-effort selection restore (block must still exist + offset still valid).
    if (savedSelection) applySelectionToDom(this.ctx._hosts(), savedSelection);

    this.domDirty = false;
    this.mirrorToYDoc();
    this.emitChangeNow();
    return ok<T>(value as T, affected);
  }

  /**
   * Ensure the doc reflects the latest edits. If the DOM has been dirtied
   * by user typing / paste / drop, pull the latest content out of it and
   * bump affected block versions. If the last mutation came from the API,
   * the AST is already current — skip the (lossy) DOM-to-AST round-trip.
   */
  ensureCurrent(): SobreeDocument {
    if (!this.domDirty && !this.frames.hasDirtyFrames()) return this.ctx.doc;
    return this.syncFromDom();
  }

  syncFromDom(): SobreeDocument {
    // Classify the change so the host knows whether the floating overlay
    // is already current (live frame typing) or stale (anything else).
    const bodyChanged = this.domDirty;
    const frameChanged = this.frames.hasDirtyFrames();
    this.pendingLiveFrameEdit = frameChanged && !bodyChanged;
    // Body read-back — only when a body host actually changed. A pure
    // frame edit (domDirty false) must NOT re-serialise the body: that
    // would churn the registry and risk clobbering AST-only properties.
    if (this.domDirty) {
      const { document: serialised, sources } = serializeHostsWithSources(
        this.ctx.getContentHosts(),
      );
      const prevCount = this.ctx.registry.length();
      const newCount = serialised.body.length;

      // The contentEditable DOM is a LOSSY projection — it carries run text
      // and inline marks, but NOT block-level properties (paragraph
      // spacing/indent/borders, table style-id/look/cell-margins,
      // section-break targets). A text or structural edit changes a block's
      // CONTENT, never those properties, so re-deriving the whole AST from
      // the DOM strips them and the doc falls apart on the next re-render
      // (undo / redo / remote). Match each re-read block to its previous AST
      // block by stable id (`data-block-id`, stamped by the renderer, read
      // off the source element here) and overlay only the re-read content —
      // properties survive across typing AND structural edits alike.
      const prevById = new Map<string, Block>();
      const prevIds = this.allBlockIds();
      this.ctx.doc.body.forEach((b, i) => {
        const id = prevIds[i];
        if (id) prevById.set(id, b);
      });
      const body = mergeReadbackBlocks(serialised.body, (i) => {
        const id = sources[i]?.dataset.blockId;
        return id ? prevById.get(id) : undefined;
      });

      if (newCount !== prevCount) {
        // Structural change (Enter / Backspace, paste inserted blocks):
        // re-stamp the registry. Agents that held stale refs see lock
        // failures. The id-keyed merge above already carried each surviving
        // block's properties across the shift.
        this.ctx.registry.reset(newCount);
        // Re-stamp the live DOM's `data-block-id` to the fresh registry ids
        // (positional now that the body is rebuilt) WITHOUT a re-render —
        // which would clobber the caret mid-edit. This keeps the DOM ids in
        // step with the registry, so a subsequent un-rendered edit can still
        // match blocks by id instead of silently re-deriving (lossily).
        const newIds = this.allBlockIds();
        sources.forEach((el, i) => {
          const id = newIds[i];
          if (el && id) el.dataset.blockId = id;
        });
        this.lastSerialisedBlocks = body.map((b) => JSON.stringify(b));
      } else {
        // Same count: bump the versions of blocks whose merged JSON changed.
        const newJson = body.map((b) => JSON.stringify(b));
        const changed: boolean[] = newJson.map((j, i) => j !== this.lastSerialisedBlocks[i]);
        this.lastSerialisedBlocks = newJson;
        this.ctx.registry.bumpChanged(changed);
      }
      this.ctx.setDoc({
        ...this.ctx.doc,
        body,
        numbering: serialised.numbering,
      });
      this.domDirty = false;
    }
    // Frame read-back — re-serialise each edited textbox frame's DOM into
    // its `content.body`. Frames live in the floating overlay, outside the
    // body hosts, so they're invisible to the body serializer above.
    if (this.frames.hasDirtyFrames()) this.frames.syncFramesFromDom();
    this.mirrorToYDoc();
    return this.ctx.doc;
  }

  /**
   * Schedule a DOM-driven change emit. Called from the `input` listener
   * when the user types — the DOM is the source of truth and we sync the
   * AST from it before notifying listeners.
   */
  scheduleChange(): void {
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
  emitChangeNow(): void {
    this.revision += 1;
    // Consume the flag here (not only when there are listeners) so a
    // later emit can't inherit a stale `true`.
    const liveFrameEdit = this.pendingLiveFrameEdit;
    this.pendingLiveFrameEdit = false;
    if (!this.events.hasChangeListeners()) return;
    const stripped = stripBinary(this.ctx.doc);
    this.events.emitChange({
      doc: stripped,
      // Alias for backwards compat — same reference, no clone cost.
      document: stripped,
      revision: this.revision,
      documentVersion: this.ctx.registry.documentVersion(),
      ...(liveFrameEdit ? { liveFrameEdit: true } : {}),
    });
  }

  // === render / replace ===

  /**
   * Re-render the current `doc` into the content hosts. Syncs
   * `@font-face` registrations BEFORE rendering so newly-embedded fonts
   * are available to the render pass. No selection restore, no change
   * emit — callers sequence those.
   */
  renderCurrent(): void {
    const hosts = this.ctx.getContentHosts();
    for (const h of hosts) h.replaceChildren();
    const firstHost = hosts[0] ?? this.ctx.host;
    this.ctx.fontFaces.sync(this.ctx.doc.fonts, this.ctx.doc.rawParts);
    renderSobreeDocument(this.ctx.doc, firstHost, this.blockIdsArray());
  }

  /**
   * Soft-revert to a doc `snapshot` and re-render. Resets the
   * serialised-block cache + dom-dirty flag; no registry reset, mirror, or
   * change emit. Used to undo native IME mutations before a tracked
   * re-insert (see `ops/trackedInput`).
   */
  restoreSnapshot(snapshot: SobreeDocument): void {
    this.ctx.setDoc(snapshot);
    this.lastSerialisedBlocks = snapshot.body.map((b) => JSON.stringify(b));
    this.domDirty = false;
    this.renderCurrent();
  }

  /**
   * Internal apply path shared by `setDocument` and any other
   * full-replace caller. The Y.Doc mirror produces tracked Y
   * operations that Y.UndoManager turns into a single stack item.
   */
  applyDocument(doc: SobreeDocument): void {
    this.ctx.setDoc(doc);
    this.ctx.registry.reset(doc.body.length);
    this.lastSerialisedBlocks = doc.body.map((b) => JSON.stringify(b));
    this.renderCurrent();
    this.domDirty = false;
    this.mirrorToYDoc();
    this.emitChangeNow();
  }

  // === Y.Doc mirroring ===

  /**
   * Parallel array of live block ids (same length as `doc.body`), used by
   * the renderer to stamp `data-block-id` onto every block element. Lets
   * external tools (block tools, embedders) locate a block's DOM element
   * after the body is re-rendered from scratch.
   */
  blockIdsArray(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.ctx.doc.body.length; i++) {
      out.push(this.ctx.registry.refAt(i).id);
    }
    return out;
  }

  /**
   * Snapshot of the live block ids in body order — used both as the input
   * to `applyDocumentToYDoc` (so each Y.Map carries its stable id) and as
   * the `blockIdsArray()` the renderer uses to set the `data-block-id`
   * attribute.
   */
  allBlockIds(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.ctx.registry.length(); i++) {
      out.push(this.ctx.registry.refAt(i).id);
    }
    return out;
  }

  /**
   * Mirror the current `doc` into the Y.Doc as a single transaction. The
   * diff is performed by `applyDocumentToYDoc`, which matches blocks by id
   * so concurrent edits to *different* blocks merge cleanly via the
   * Y.Array CRDT.
   *
   * Origin is `"local"` so a future Y observer can distinguish locally-
   * driven mutations (already rendered) from remote ones (need re-render).
   */
  mirrorToYDoc(): void {
    // When a BlobStore is configured, any path that's been migrated to a
    // partRef (or is currently being migrated) must not get mirrored
    // inline — that would re-introduce the bytes into the Y.Doc. Without a
    // BlobStore, the skip set is empty and behavior is identical to today.
    const skip = parts.computePartPathSkipSet(this.ctx);
    applyDocumentToYDoc(
      this.ctx.ydoc,
      this.ctx.doc,
      this.allBlockIds(),
      "local",
      skip ? { skipPartPaths: skip } : {},
    );
  }

  /**
   * Re-project the Y.Doc into `doc`, sync the BlockRegistry to the
   * projected ids, re-render the DOM, and fire `change`. Called when a
   * remote provider applies an update we didn't initiate.
   */
  adoptYDocState(): void {
    const projected = projectYDoc(this.ctx.ydoc);
    this.ctx.setDoc(projected.doc);
    this.ctx.registry.adoptIds(projected.ids);
    this.lastSerialisedBlocks = projected.doc.body.map((b) => JSON.stringify(b));
    this.ctx.setLastPartRefs(projected.partRefs);
    // Resolve hash-addressed parts through the local cache. Hashes not yet
    // cached: kick off background fetches; `onBlobResolved` patches +
    // re-renders when they land.
    parts.resolveCachedPartRefsInto(this.ctx, this.ctx.doc);
    const blobCache = this.ctx.blobCache;
    if (blobCache) {
      const missing = Object.values(projected.partRefs).filter((h) => !blobCache.has(h));
      if (missing.length > 0) {
        void blobCache.ensureLoaded(missing);
      }
    }
    const hosts = this.ctx.getContentHosts();
    for (const h of hosts) h.replaceChildren();
    const firstHost = hosts[0] ?? this.ctx.host;
    this.ctx.fontFaces.sync(this.ctx.doc.fonts, this.ctx.doc.rawParts);
    renderSobreeDocument(this.ctx.doc, firstHost, this.blockIdsArray());
    this.domDirty = false;
    this.emitChangeNow();
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
