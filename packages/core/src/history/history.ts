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
import {
  type CapturedSelection,
  DEFAULT_HISTORY_CONFIG,
  type HistoryConfig,
  type HistoryDepth,
  type UndoSelections,
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
  /** Capture the *current* (post-edit) live selection — called as a
   *  stack item is added/updated, stashed as the step's `after`. Returns
   *  a body `Selection` or a frame selection; `History` keeps it opaque. */
  captureSelection: () => CapturedSelection;
  /** Capture the selection as it was BEFORE the edit that opened the
   *  current undo step — stashed as the step's `before` and restored on
   *  undo. Defaults to {@link captureSelection} when not provided (callers
   *  without a pre-edit hook, e.g. headless, get post-edit on both). */
  capturePreEditSelection?: () => CapturedSelection;
  /** Restore a previously-captured selection to the live DOM /
   *  EditorSelection. Called on undo / redo after the Y.Doc has been
   *  re-projected and re-rendered. */
  restoreSelection: (sel: CapturedSelection) => void;
  /** Notify the caller that the current undo group has captured (or
   *  extended) its selection, so it can drop any pending pre-edit stash.
   *  Fires on every `stack-item-added` / `stack-item-updated`. */
  onGroupSettled?: () => void;
}

/** Meta key used to stash captured selection on each stack item. */
const META_SELECTION_KEY = "sobree:selection";

export class History {
  private readonly mgr: Y.UndoManager;
  private readonly listeners = new Set<HistoryListener>();
  private readonly captureSelection: () => CapturedSelection;
  private readonly capturePreEditSelection: () => CapturedSelection;
  private readonly restoreSelection: (sel: CapturedSelection) => void;
  private readonly onGroupSettled: () => void;

  constructor(opts: HistoryOptions) {
    this.captureSelection = opts.captureSelection;
    this.capturePreEditSelection = opts.capturePreEditSelection ?? opts.captureSelection;
    this.restoreSelection = opts.restoreSelection;
    this.onGroupSettled = opts.onGroupSettled ?? (() => {});
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

    // A NEW undo group opens. Yjs fires this synchronously at the end of
    // the tracked transaction — after the AST mutator produced the new
    // state, so the live selection is the POST-edit position (`after`).
    // The PRE-edit position (`before`) was stashed by the editor's
    // beforeinput hook; restoring it on undo lands the caret where the
    // edit began — Word/Docs behaviour.
    this.mgr.on("stack-item-added", ({ stackItem }) => {
      const sels: UndoSelections = {
        before: this.capturePreEditSelection(),
        after: this.captureSelection(),
      };
      stackItem.meta.set(META_SELECTION_KEY, sels);
      this.onGroupSettled();
      this.fire();
    });

    // An op COALESCED into the open group (within `captureTimeout`). Keep
    // the group's original `before`, but extend `after` to the new end so
    // redo lands at the tail of the whole burst.
    this.mgr.on("stack-item-updated", ({ stackItem }) => {
      const sels = stackItem.meta.get(META_SELECTION_KEY) as UndoSelections | undefined;
      if (sels) sels.after = this.captureSelection();
      this.onGroupSettled();
    });

    // On pop (undo / redo), the inverse Y ops have already run and the
    // editor's afterTransaction observer has re-projected + re-rendered.
    // Undo restores where the edit BEGAN; redo, where it ENDED.
    this.mgr.on("stack-item-popped", ({ stackItem, type }) => {
      const sels = stackItem.meta.get(META_SELECTION_KEY) as UndoSelections | undefined;
      if (sels) this.restoreSelection(type === "undo" ? sels.before : sels.after);
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

  /**
   * Close the current undo-capture group so the NEXT local edit starts a
   * fresh undo step instead of coalescing into the previous one (within
   * `captureTimeout`). The editor calls this when the editing context
   * changes — e.g. the caret moves to a different textbox frame, or
   * between a frame and the body — so two distinct edits don't collapse
   * into a single undo. No-op when there's nothing pending to capture.
   */
  stopCapturing(): void {
    this.mgr.stopCapturing();
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
