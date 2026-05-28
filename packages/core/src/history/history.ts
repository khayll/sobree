/**
 * Undo / redo for the Sobree editor — backed by `Y.UndoManager`.
 *
 * # Why Y.UndoManager
 *
 * Phase 1b.6 swaps the snapshot-stack History for `Y.UndoManager` so:
 *
 *   1. **Per-peer undo.** UndoManager tracks operations by *origin*.
 *      When a peer types, those Y operations are tagged `"local"`. A
 *      remote peer's edits arrive with a different origin (the
 *      provider name), so the local UndoManager doesn't see them as
 *      its own. `Cmd+Z` reverses only the local user's edits — exactly
 *      what users expect in collab.
 *
 *   2. **CRDT-native.** Undoing produces *inverse Y operations*, which
 *      flow through the same broadcast pipeline as forward edits. No
 *      separate "undo over the wire" protocol needed.
 *
 *   3. **No snapshot stack.** Memory is bounded by Yjs's internal item
 *      list; no separate snapshot bookkeeping.
 *
 * # API compatibility
 *
 * The public surface (`undo`, `redo`, `canUndo`, `canRedo`, `clear`,
 * `depth`, `on`) matches the old History so the Editor's command-bus
 * registrations and the keyboard plugin's `Cmd+Z` mapping work
 * unchanged. The legacy `recordCommit` / `recordTyping` / `flush`
 * methods are kept as no-ops — UndoManager auto-tracks ops by origin
 * and `captureTimeout` handles coalescing without explicit "begin a
 * typing session" calls.
 *
 * # Selection restore
 *
 * Each undo/redo step needs to restore the cursor to its pre-edit
 * position. We capture the live selection in `stack-item-added`'s
 * `meta` and restore it on `stack-item-popped`. The restore happens
 * AFTER the editor has re-projected and re-rendered (the Y observer
 * fires before the popped event — see `Editor.adoptYDocState`).
 */

import * as Y from "yjs";
import type { Selection } from "../doc/api";
import {
  DEFAULT_HISTORY_CONFIG,
  type HistoryConfig,
  type HistoryDepth,
} from "./types";

export type HistoryEvent = "change";
export type HistoryListener = (depth: HistoryDepth) => void;

export interface HistoryOptions extends Partial<HistoryConfig> {
  /** Y.Doc to track. The UndoManager observes the body, meta, and
   *  parts top-level types — every Sobree mutation funnels through
   *  one of these, so any local edit produces a stack entry. */
  ydoc: Y.Doc;
  /** Origin string used by the Editor's `mirrorToYDoc()` and other
   *  local writes. UndoManager only tracks operations whose origin
   *  is in this set. Defaults to `"local"`. */
  localOrigin?: unknown;
  /** Capture the *current* live selection — called as a stack item
   *  is being added so we can stash it for restore on undo. */
  captureSelection: () => Selection;
  /** Restore a previously-captured selection to the live DOM /
   *  EditorSelection. Called on undo / redo after the Y.Doc has been
   *  re-projected and re-rendered. */
  restoreSelection: (sel: Selection) => void;
}

/** Meta key used to stash captured selection on each stack item. */
const META_SELECTION_KEY = "sobree:selection";

export class History {
  private readonly mgr: Y.UndoManager;
  private readonly listeners = new Set<HistoryListener>();
  private readonly captureSelection: () => Selection;
  private readonly restoreSelection: (sel: Selection) => void;

  constructor(opts: HistoryOptions) {
    this.captureSelection = opts.captureSelection;
    this.restoreSelection = opts.restoreSelection;
    const captureTimeout = opts.coalesceIdleMs ?? DEFAULT_HISTORY_CONFIG.coalesceIdleMs;
    const localOrigin = opts.localOrigin ?? "local";

    // Track every top-level Y type the editor mutates: body, meta,
    // parts. Anything written by `mirrorToYDoc` or by direct Y.Text
    // operations on a body block lands in one of these — so the
    // UndoManager catches every local mutation.
    //
    // Each Y type's event-handler generic doesn't unify with
    // `AbstractType<unknown>` in TS, but Yjs accepts the array at
    // runtime. Cast at the boundary.
    const tracked = [
      opts.ydoc.getArray("body"),
      opts.ydoc.getMap("meta"),
      opts.ydoc.getMap("parts"),
    ] as unknown as Y.AbstractType<unknown>[];

    this.mgr = new Y.UndoManager(tracked, {
      captureTimeout,
      trackedOrigins: new Set([localOrigin]),
    });

    // Stash the pre-edit selection on each newly-added stack item.
    // Yjs fires this synchronously at the end of a tracked
    // transaction — after the AST mutator has produced the new state.
    // We capture the LIVE selection here, which is the post-edit
    // position. For undo, we want the *pre-edit* position; that's
    // captured separately via the input listener (see Editor).
    this.mgr.on("stack-item-added", ({ stackItem }) => {
      stackItem.meta.set(META_SELECTION_KEY, this.captureSelection());
      this.fire();
    });

    // On pop (undo / redo), the inverse Y ops have already run and
    // the editor's afterTransaction observer has re-projected +
    // re-rendered. Restore selection to whatever was captured.
    this.mgr.on("stack-item-popped", ({ stackItem }) => {
      const sel = stackItem.meta.get(META_SELECTION_KEY) as Selection | undefined;
      if (sel !== undefined) this.restoreSelection(sel);
      this.fire();
    });
  }

  // === public API (kept compatible with the snapshot-era History) ===

  undo(): boolean {
    return this.mgr.undo() !== null;
  }

  redo(): boolean {
    return this.mgr.redo() !== null;
  }

  canUndo(): boolean {
    return this.mgr.canUndo();
  }

  canRedo(): boolean {
    return this.mgr.canRedo();
  }

  clear(): void {
    this.mgr.clear();
    this.fire();
  }

  depth(): HistoryDepth {
    return {
      undo: this.mgr.undoStack.length,
      redo: this.mgr.redoStack.length,
    };
  }

  on(_event: HistoryEvent, cb: HistoryListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  destroy(): void {
    this.mgr.destroy();
    this.listeners.clear();
  }

  // === legacy methods kept as no-ops for API compatibility ===

  /** @deprecated UndoManager auto-tracks ops by origin; no need to
   *  call this. Kept as a no-op so the Editor's existing call sites
   *  don't break. */
  recordCommit(): void {
    /* no-op */
  }

  /** @deprecated UndoManager's `captureTimeout` coalesces consecutive
   *  ops into one stack item. No explicit recording needed. */
  recordTyping(): void {
    /* no-op */
  }

  /** @deprecated UndoManager flushes implicitly on `captureTimeout`
   *  expiry or on the next non-tracked operation. */
  flush(): void {
    /* no-op */
  }

  // === internals ===

  private fire(): void {
    const d = this.depth();
    for (const cb of this.listeners) {
      try {
        cb(d);
      } catch (err) {
        console.error("[history] listener threw:", err);
      }
    }
  }
}

// === legacy re-exports (kept so external code keeps importing) ===
//
// `makeEntry` / `selectionToSnapshot` / `snapshotToSelection` were the
// helpers the snapshot-era History used to convert id-keyed selections
// to index-keyed snapshots so they survived a `BlockRegistry.reset`.
// With UndoManager, the registry isn't reset on undo/redo — the
// adoptIds path keeps ids stable — so id-keyed selections work as-is.
// These helpers are no-op-shaped pass-throughs kept for backwards-compat.

import type { Selection as PublicSelection } from "../doc/api";

/** @deprecated Selection survives undo/redo via stable block ids now;
 *  no snapshot-conversion is needed. Kept as a pass-through stub. */
export function makeEntry(
  doc: unknown,
  selection: PublicSelection,
  reason: string,
  _indexOfBlock: (id: string) => number,
): { doc: unknown; selection: PublicSelection; reason: string; timestamp: number } {
  return { doc, selection, reason, timestamp: Date.now() };
}

/** @deprecated Pass-through; selection structure is no longer
 *  index-keyed in the new history. */
export function selectionToSnapshot(
  selection: PublicSelection,
  _indexOfBlock: (id: string) => number,
): PublicSelection {
  return selection;
}

/** @deprecated Pass-through; selection survives via stable ids. */
export function snapshotToSelection(
  snap: PublicSelection,
  _refAt: (idx: number) => unknown,
): PublicSelection {
  return snap;
}
