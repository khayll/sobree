/**
 * HeadlessSobree — a no-DOM Sobree peer for LLM agents, automation,
 * back-end pipelines, MCP servers, anywhere code needs to read or
 * write a Sobree document without rendering it.
 *
 * # The shape
 *
 * Same mental model as the browser editor: hold a `Y.Doc`, read it
 * as a `SobreeDocument` projection, write through typed mutation
 * methods, get a `change` event on every update (local or remote).
 * The difference: no DOM, no rendering, no selection-from-DOM logic.
 * Selection is just a value field you can read / write.
 *
 * # Use cases
 *
 *   1. **LLM agents.** Connect a Y-websocket provider to a Sobree
 *      room; the LLM sees the same doc the user sees. It can read
 *      structure (paragraphs, headings, runs) and apply edits that
 *      propagate back through Y.
 *
 *   2. **Server-side rendering / export.** Run `editor.toDocx()` in
 *      a Node worker against a snapshot loaded from `@sobree/collab-server`'s
 *      persistence backend.
 *
 *   3. **Automation pipelines.** Cron job that processes inbound
 *      content and writes formatted reports to a Sobree doc.
 *
 *   4. **Tests.** Build a fixture document programmatically without
 *      a DOM environment.
 *
 * # What it's NOT
 *
 *   - A *relay*. That's `@sobree/collab-server` — a Node server that
 *     fans out Y messages between many peers. HeadlessSobree is a
 *     single peer with its own Y.Doc.
 *   - A *full editor*. The browser `Editor` adds DOM rendering,
 *     contentEditable event handling, image-resize handles, paste
 *     parsing, etc. HeadlessSobree skips all that — if you need
 *     them, mount a real Editor.
 *   - A *table editor*. The browser `Editor` has a rich table API
 *     (`editor.table.insertRow`, etc.). HeadlessSobree v0 doesn't
 *     wrap that — operate on `Table` blocks directly via
 *     `replaceBlock` until Phase 4.x adds a parallel table API.
 *
 * # Origin tagging
 *
 * Every mutation writes to the Y.Doc with a configurable origin
 * (default `"headless"`). The local `Y.UndoManager` tracks only that
 * origin — so the peer's `Cmd+Z`-equivalent (`peer.history.undo()`)
 * reverses only its own edits, not the human peers'. Pick a stable
 * per-peer origin string (e.g. `"agent:gpt-4-2024-05"`) if you want
 * post-hoc telemetry to identify the author.
 */

import type * as Y from "yjs";
import { BlobCache, type BlobStore } from "./blob";
import {
  type BlockRef,
  type EditError,
  type EditResult,
  type Selection,
  fail,
  lockConflict,
  ok,
} from "./doc/api";
import { emptyDocument } from "./doc/builders";
import { runsLength } from "./doc/runs";
import type { Block, ParagraphAlignment, ParagraphProperties, SobreeDocument } from "./doc/types";
import { headingLevelOf, runsToText } from "./doc/walk";
import { EditorCommands, type ParagraphPropertiesPatch } from "./editor";
import type { BlockInfo, CommandBus, OutlineItem } from "./editor";
import { BlockRegistry } from "./editor/internal/blockRegistry";
import {
  type Mutation,
  mergeParagraphProps,
  mergeSectionsAcross,
  removedSectionIndex,
} from "./editor/internal/mutations";
import { History } from "./history";
import { applyDocumentToYDoc, projectYDoc, seedYDoc } from "./ydoc";

export interface HeadlessSobreeOptions {
  /**
   * Origin string used for this peer's Y.Doc mutations. Identifies
   * the source in `afterTransaction` events and scopes the
   * Y.UndoManager. Default `"headless"`.
   */
  origin?: string;
  /**
   * Initial document. Used only if the Y.Doc is empty at construction
   * time — same semantics as `Editor.initialDocument`. If the Y.Doc
   * is non-empty (a peer joining an active room), this is ignored
   * and the existing state is adopted.
   */
  initialDocument?: SobreeDocument;
  /**
   * Override the BlockRegistry's id prefix. Default is
   * `${ydoc.clientID.toString(36)}_` — same convention the browser
   * `Editor` uses, so newly-minted block ids never collide across
   * peers.
   */
  idPrefix?: string;
  /**
   * Optional content-hashed `BlobStore` (Phase 3.2+). Without one,
   * binary parts ride inline in the Y.Doc; with one, the headless
   * peer resolves `partRefs` hashes via a local `BlobCache` and
   * fetches missing bytes from the store on demand. See
   * `EditorOptions.blobStore` for the full contract.
   */
  blobStore?: BlobStore;
}

export type HeadlessEvent = "change";
export interface HeadlessChangePayload {
  doc: SobreeDocument;
  /** Whether the change originated from THIS peer's mutations
   *  (true) or arrived via a Y provider from a remote peer (false). */
  local: boolean;
}
export type HeadlessUnsubscribe = () => void;

/**
 * Headless Sobree peer. Construct with a `Y.Doc` — typically one
 * you've already attached a provider to. Reads project through the
 * Y.Doc; writes mirror back inside `Y.Doc.transact` with the
 * configured origin.
 */
export class HeadlessSobree {
  readonly ydoc: Y.Doc;
  readonly commands: CommandBus;
  readonly history: History;
  readonly origin: string;
  /** Optional content-hashed blob layer. Mirrors the browser `Editor`'s
   *  `blobStore` field — null when no store is configured. */
  readonly blobStore: BlobStore | null;
  /** Local cache for blob bytes. Null when no `blobStore` is set. */
  readonly blobCache: BlobCache | null;

  private doc: SobreeDocument;
  private readonly registry: BlockRegistry;
  private currentSelection: Selection = null;
  private readonly listeners: { change: Set<(p: HeadlessChangePayload) => void> } = {
    change: new Set(),
  };
  private lastPartRefs: Record<string, string> = {};
  private ydocUpdateListener: ((tr: Y.Transaction) => void) | null = null;

  constructor(ydoc: Y.Doc, opts: HeadlessSobreeOptions = {}) {
    this.ydoc = ydoc;
    this.origin = opts.origin ?? "headless";
    this.commands = new EditorCommands();
    this.registry = new BlockRegistry({
      idPrefix: opts.idPrefix ?? `${ydoc.clientID.toString(36)}_`,
    });

    this.blobStore = opts.blobStore ?? null;
    this.blobCache = this.blobStore
      ? new BlobCache({
          store: this.blobStore,
          onResolved: (hash) => this.onBlobResolved(hash),
        })
      : null;

    // Adopt-or-seed: same logic as the browser Editor. If the Y.Doc
    // already has body content, we're a peer joining an active room
    // and we adopt verbatim. Otherwise seed from `initialDocument`
    // (or an empty doc).
    const ydocBody = this.ydoc.getArray<Y.Map<unknown>>("body");
    if (ydocBody.length === 0) {
      this.doc = opts.initialDocument ?? emptyDocument();
      this.registry.reset(this.doc.body.length);
      seedYDoc(this.ydoc, this.doc, this.allBlockIds());
      this.lastPartRefs = {};
    } else {
      const projected = projectYDoc(this.ydoc);
      this.doc = projected.doc;
      this.registry.adoptIds(projected.ids);
      this.lastPartRefs = projected.partRefs;
      this.resolveCachedPartRefsInto(this.doc);
    }

    // Y.UndoManager-backed history, scoped to this peer's origin.
    // Selection is captured / restored against `currentSelection` —
    // useful for an agent that wants to remember where it was
    // "looking" before each edit and snap back on undo.
    this.history = new History({
      ydoc: this.ydoc,
      localOrigin: this.origin,
      captureSelection: () => this.currentSelection,
      restoreSelection: (sel) => {
        this.currentSelection = sel;
      },
    });

    // Register the same history commands as the browser editor — so
    // an MCP wrapper can `commands.execute("history.undo")` and get
    // the same behaviour.
    this.commands.register({
      name: "history.undo",
      title: "Undo",
      run: () => {
        this.history.undo();
      },
      isAvailable: () => this.history.canUndo(),
    });
    this.commands.register({
      name: "history.redo",
      title: "Redo",
      run: () => {
        this.history.redo();
      },
      isAvailable: () => this.history.canRedo(),
    });

    // Remote-update observer: re-project + fire change for any
    // Y.Doc transaction NOT originating from this peer.
    this.ydocUpdateListener = (tr: Y.Transaction) => {
      if (tr.origin === this.origin || tr.origin === "seed") return;
      this.adoptYDocState();
      this.fireChange(false);
    };
    this.ydoc.on("afterTransaction", this.ydocUpdateListener);
  }

  // === reads ===

  /** Current document — a fresh projection of the Y.Doc state. */
  getDocument(): SobreeDocument {
    return this.doc;
  }

  /** Summary of every top-level block. */
  getBlocks(): BlockInfo[] {
    return this.doc.body.map((block, index) => this.summariseBlock(block, index));
  }

  getBlock(index: number): BlockInfo {
    const blocks = this.getBlocks();
    const b = blocks[index];
    if (!b) throw new Error(`block index ${index} out of range`);
    return b;
  }

  getBlockById(id: string): BlockInfo | null {
    const index = this.registry.indexOf(id);
    if (index < 0) return null;
    return this.getBlock(index);
  }

  /** Heading outline — one entry per `paragraph` block whose
   *  resolved style identifies it as a heading. */
  getOutline(): OutlineItem[] {
    const out: OutlineItem[] = [];
    this.doc.body.forEach((block, index) => {
      if (block.kind !== "paragraph") return;
      const level = headingLevelOf(block);
      if (!level) return;
      out.push({
        level,
        text: runsToText(block.runs),
        blockIndex: index,
        block: this.registry.refAt(index),
      });
    });
    return out;
  }

  /** This peer's stored selection — same shape `editor.selection.get()`
   *  returns. `null` when no selection is set. */
  getSelection(): Selection {
    return this.currentSelection;
  }

  /**
   * Set this peer's selection. Stored as a value (no DOM update);
   * the value is what `history` captures on each mutation and
   * restores on undo.
   */
  setSelection(selection: Selection): void {
    this.currentSelection = selection;
  }

  // === mutations ===

  /** Replace the document. */
  setDocument(doc: SobreeDocument): void {
    this.doc = doc;
    this.registry.reset(doc.body.length);
    this.mirror();
    this.fireChange(true);
  }

  /** Replace the block at `target`'s index with `block`. */
  replaceBlock(target: BlockRef, block: Block): EditResult<BlockRef> {
    const lockCheck = this.checkRefs([target]);
    if (lockCheck) return lockCheck;
    const index = this.registry.indexOf(target.id);
    const next = this.doc.body.slice();
    const wasSectionBreak = next[index]?.kind === "section_break";
    next[index] = block;
    const update: Partial<SobreeDocument> = { body: next };
    if (wasSectionBreak && block.kind !== "section_break") {
      update.sections = mergeSectionsAcross(
        this.doc.sections,
        removedSectionIndex(this.doc.body, index),
      );
    }
    return this.commit(update, [{ type: "bump", index }]);
  }

  /** Insert `block` before the target block. */
  insertBlockBefore(target: BlockRef, block: Block): EditResult<BlockRef> {
    const lockCheck = this.checkRefs([target]);
    if (lockCheck) return lockCheck;
    const index = this.registry.indexOf(target.id);
    const next = this.doc.body.slice();
    next.splice(index, 0, block);
    return this.commit({ body: next }, [{ type: "insert", index }]);
  }

  /** Insert `block` after the target block. */
  insertBlockAfter(target: BlockRef, block: Block): EditResult<BlockRef> {
    const lockCheck = this.checkRefs([target]);
    if (lockCheck) return lockCheck;
    const index = this.registry.indexOf(target.id);
    const next = this.doc.body.slice();
    next.splice(index + 1, 0, block);
    return this.commit({ body: next }, [{ type: "insert", index: index + 1 }]);
  }

  /** Delete the target block. */
  deleteBlock(target: BlockRef): EditResult<void> {
    const lockCheck = this.checkRefs([target]);
    if (lockCheck) return lockCheck;
    const index = this.registry.indexOf(target.id);
    const wasSectionBreak = this.doc.body[index]?.kind === "section_break";
    const next = this.doc.body.slice();
    next.splice(index, 1);
    if (next.length === 0) next.push({ kind: "paragraph", properties: {}, runs: [] });
    const update: Partial<SobreeDocument> = { body: next };
    if (wasSectionBreak) {
      update.sections = mergeSectionsAcross(
        this.doc.sections,
        removedSectionIndex(this.doc.body, index),
      );
    }
    return this.commit(update, [{ type: "remove", index }]);
  }

  /** Merge a patch into each target paragraph's properties. */
  applyBlockProperties(targets: BlockRef[], patch: ParagraphPropertiesPatch): EditResult<void> {
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
      next[index] = {
        ...block,
        properties: mergeParagraphProps(block.properties, patch),
      };
      bumps.push({ type: "bump", index });
    }
    return this.commit({ body: next }, bumps);
  }

  // === events ===

  on<E extends HeadlessEvent>(
    event: E,
    cb: (payload: HeadlessChangePayload) => void,
  ): HeadlessUnsubscribe {
    if (event !== "change") {
      throw new Error(`unknown event: ${String(event)}`);
    }
    this.listeners.change.add(cb);
    return () => this.listeners.change.delete(cb);
  }

  // === lifecycle ===

  destroy(): void {
    if (this.ydocUpdateListener) {
      this.ydoc.off("afterTransaction", this.ydocUpdateListener);
      this.ydocUpdateListener = null;
    }
    this.history.destroy();
    this.listeners.change.clear();
  }

  // === internals ===

  private allBlockIds(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.registry.length(); i++) {
      out.push(this.registry.refAt(i).id);
    }
    return out;
  }

  private mirror(): void {
    applyDocumentToYDoc(this.ydoc, this.doc, this.allBlockIds(), this.origin);
  }

  private adoptYDocState(): void {
    const projected = projectYDoc(this.ydoc);
    this.doc = projected.doc;
    this.registry.adoptIds(projected.ids);
    this.lastPartRefs = projected.partRefs;
    this.resolveCachedPartRefsInto(this.doc);
    if (this.blobCache) {
      const missing = Object.values(projected.partRefs).filter((h) => !this.blobCache!.has(h));
      if (missing.length > 0) {
        void this.blobCache.ensureLoaded(missing);
      }
    }
  }

  private resolveCachedPartRefsInto(doc: SobreeDocument): void {
    if (!this.blobCache) return;
    for (const [path, hash] of Object.entries(this.lastPartRefs)) {
      if (doc.rawParts[path]) continue;
      const bytes = this.blobCache.get(hash);
      if (bytes) doc.rawParts[path] = bytes;
    }
  }

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
    if (touched) this.fireChange(false);
  }

  /**
   * Wait for every currently-referenced binary part to be available
   * in the local cache. No-op when no `blobStore` is configured.
   */
  async ensurePartsLoaded(): Promise<void> {
    if (!this.blobCache) return;
    const hashes = Object.values(this.lastPartRefs);
    if (hashes.length === 0) return;
    await this.blobCache.ensureLoaded(hashes);
    this.resolveCachedPartRefsInto(this.doc);
  }

  private checkRefs(refs: readonly BlockRef[]): EditResult<never> | null {
    for (const ref of refs) {
      const current = this.registry.refById(ref.id);
      if (!current) {
        return fail({
          code: "invalid-position",
          details: `block id ${ref.id} not found`,
        });
      }
      if (current.version !== ref.version) {
        return lockConflict([{ blockId: ref.id, expected: ref.version, actual: current.version }]);
      }
    }
    return null;
  }

  private commit<T = void>(
    update: Partial<SobreeDocument>,
    mutations: readonly Mutation[],
    value?: T,
  ): EditResult<T> {
    const next: SobreeDocument = { ...this.doc, ...update };
    const affected: BlockRef[] = [];
    for (const m of mutations) {
      if (m.type === "insert") affected.push(this.registry.insert(m.index));
      else if (m.type === "remove") this.registry.remove(m.index);
      else if (m.type === "bump") affected.push(this.registry.bump(m.index));
    }
    this.doc = next;
    this.mirror();
    this.fireChange(true);
    return ok<T>(value as T, affected);
  }

  private fireChange(local: boolean): void {
    if (this.listeners.change.size === 0) return;
    const payload: HeadlessChangePayload = { doc: this.doc, local };
    for (const cb of this.listeners.change) {
      try {
        cb(payload);
      } catch (err) {
        console.error("[headless] change listener threw:", err);
      }
    }
  }

  private summariseBlock(block: Block, index: number): BlockInfo {
    const ref = this.registry.refAt(index);
    if (block.kind === "paragraph") {
      const text = runsToText(block.runs);
      const length = runsLength(block.runs);
      const info: BlockInfo = {
        index,
        id: ref.id,
        version: ref.version,
        kind: block.kind,
        text,
        length,
      };
      if (block.properties.styleId) info.styleId = block.properties.styleId;
      if (block.properties.alignment) info.alignment = block.properties.alignment;
      return info;
    }
    if (block.kind === "table") {
      return {
        index,
        id: ref.id,
        version: ref.version,
        kind: block.kind,
        text: "[table]",
        length: 0,
      };
    }
    // section_break
    return {
      index,
      id: ref.id,
      version: ref.version,
      kind: block.kind,
      text: "[section break]",
      length: 0,
    };
  }
}

// Re-exports for caller convenience — anything they need to build
// blocks or read EditResult is here under one import.
export type {
  Block,
  BlockInfo,
  BlockRef,
  EditError,
  EditResult,
  ParagraphAlignment,
  ParagraphProperties,
  Selection,
  SobreeDocument,
};
