import type * as Y from "yjs";
import type { BlobCache, BlobStore } from "../blob";
import type { Range as ApiRange, BlockRef, EditResult } from "../doc/api";
import type { SobreeDocument } from "../doc/types";
import type { FontFaceRegistry } from "../fonts";
import type { History } from "../history";
import type { BlockRegistry } from "./internal/blockRegistry";
import type { Mutation } from "./internal/mutations";
import type { EditorSelection } from "./selection";
import type { TrackChangesState } from "./types";

/**
 * The kernel seam between the `Editor` (which owns mutable state, the
 * `commit()` transaction pipeline, DOM-listener wiring, and Y.Doc
 * mirroring) and the behaviour modules (`ops/*`, `query`) that implement
 * each editing concern as free functions over this context.
 *
 * The `Editor` builds one `EditorContext` once in its constructor,
 * closing over its own privates — so `commit` / `checkRefs` / `ensureCurrent`
 * stay private to the class while the behaviour modules get exactly the
 * surface they need and nothing more. This is the state/behaviour split
 * that lets the central editor decompose without Host-seam slicing
 * (which would have to expose nearly everything).
 *
 * Members are named to match the `Editor`'s own field/method names so a
 * behaviour body reads identically whether it lives on the class or in a
 * module: `this.commit(...)` becomes `ctx.commit(...)`.
 */
export interface EditorContext {
  // === live state accessors ===
  readonly host: HTMLElement;
  readonly selection: EditorSelection;
  readonly registry: BlockRegistry;
  readonly history: History;
  readonly ydoc: Y.Doc;
  readonly blobStore: BlobStore | null;
  readonly blobCache: BlobCache | null;
  readonly fontFaces: FontFaceRegistry;
  /** Live view of the editor's current document (re-read on every access). */
  readonly doc: SobreeDocument;
  /** Replace the cached document wholesale (rare — most paths use `commit`). */
  setDoc(doc: SobreeDocument): void;
  /** Full document replace: reset registry, re-render, mirror, emit change. */
  setDocument(doc: SobreeDocument): void;
  /** Re-render the current `doc` into the hosts (no selection restore, no emit). */
  renderCurrent(): void;
  /**
   * Soft-revert the in-memory doc to `snapshot` and re-render (resets the
   * serialised-block cache + dom-dirty flag; no registry reset, mirror, or
   * emit). Used to roll back the browser's native IME mutations before a
   * tracked re-insert.
   */
  restoreSnapshot(snapshot: SobreeDocument): void;
  /** The content host(s) the renderer paints into (may differ from `host`). */
  getContentHosts(): HTMLElement[];
  /** The host(s) a DOM selection may live in. */
  _hosts(): HTMLElement[];

  // === track-changes authoring state ===
  readonly trackChanges: TrackChangesState;
  /** Set tracked-changes state WITHOUT firing the change event (internal). */
  setTrackChangesRaw(state: TrackChangesState): void;

  // === content-blob / parts migration state ===
  readonly lastPartRefs: Record<string, string>;
  setLastPartRefs(refs: Record<string, string>): void;
  readonly pendingPartRefMigrations: Set<string>;

  // === transaction pipeline (the kernel) ===
  commit<T = void>(
    update: Partial<SobreeDocument>,
    mutations: readonly Mutation[],
    value?: T,
    reason?: string,
  ): EditResult<T>;
  ensureCurrent(): SobreeDocument;
  syncFromDom(): SobreeDocument;
  checkRefs(refs: readonly BlockRef[]): EditResult<never> | null;
  checkRange(range: ApiRange, expect: Record<string, number> | undefined): EditResult<never> | null;
  emitChangeNow(): void;
  mirrorToYDoc(): void;
  scheduleChange(): void;
  setDomDirty(value: boolean): void;
}
