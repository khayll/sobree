/**
 * History config + depth shape. Phase 1b.6+ — backed by Y.UndoManager;
 * the snapshot-specific types (HistoryEntry, SnapshotPosition,
 * SnapshotSelection) that lived here in Phase 1a are no longer needed.
 */

import type { Selection } from "../doc/api";

/**
 * Selection inside an editable textbox frame. Frame bodies aren't body
 * registry blocks, so the public `Selection` model can't address them —
 * but undo/redo still needs to put the caret (or range) back. The editor
 * captures this on a frame edit and restores it on undo, exactly as it
 * does the body `Selection`; `History` treats the stashed value as opaque.
 * A collapsed caret has `start === end`.
 */
export interface FrameSelection {
  kind: "frame-selection";
  /** `data-anchor-id` of the frame the selection was in. */
  frameId: string;
  /** Character offset of the selection start across the frame's text. */
  start: number;
  /** Character offset of the selection end (=== start for a caret). */
  end: number;
}

/**
 * What the editor stashes for an undo step: a body `Selection` (incl.
 * `null` when focus is outside) or a {@link FrameSelection}. Restored
 * verbatim on undo/redo so the cursor lands where the body's would.
 */
export type CapturedSelection = Selection | FrameSelection;

/**
 * Both ends of an undo step's cursor: where it sat BEFORE the edit and
 * AFTER it. Undo restores `before` (you land where you started the edit);
 * redo restores `after` (you land where the edit left you) — Word/Docs
 * behaviour. Stashed on each `Y.UndoManager` stack item's meta.
 */
export interface UndoSelections {
  before: CapturedSelection;
  after: CapturedSelection;
}

export interface HistoryConfig {
  /** Hard cap on entry count (per stack). UndoManager doesn't expose
   *  a max-depth knob directly — kept here for forward-compat in case
   *  we add LRU-trim ourselves; Yjs's UndoManager grows unboundedly
   *  in practice (one entry per coalesced typing burst, so a long
   *  session is still bounded). */
  maxDepth: number;
  /**
   * Soft cap on rough memory footprint in bytes. Currently unused
   * (UndoManager doesn't expose memory introspection); kept for
   * future tuning. */
  maxBytesEstimate: number;
  /**
   * Idle time within which consecutive Y operations merge into one
   * undo step (Y.UndoManager's `captureTimeout`). Default 1000ms —
   * Word-style typing-session coalescing.
   */
  coalesceIdleMs: number;
}

export const DEFAULT_HISTORY_CONFIG: HistoryConfig = {
  maxDepth: 100,
  maxBytesEstimate: 10 * 1024 * 1024,
  coalesceIdleMs: 1000,
};

/** Snapshot of `{undoDepth, redoDepth}` for `History.depth()` + change events. */
export interface HistoryDepth {
  undo: number;
  redo: number;
}

// === legacy type aliases (kept so external imports from Phase 1a don't break) ===

/** @deprecated Selection now persists via stable block ids — no
 *  snapshot conversion is needed. */
export interface SnapshotPosition {
  blockIndex: number;
  offset: number;
}

/** @deprecated Pass-through alias to keep older imports compiling. */
export type SnapshotSelection =
  | null
  | { kind: "caret"; at: SnapshotPosition }
  | { kind: "range"; from: SnapshotPosition; to: SnapshotPosition };

/** @deprecated Y.UndoManager owns history state; no separate entry
 *  shape is exposed. Kept as a permissive type alias so any consumer
 *  that imported `HistoryEntry` keeps compiling. */
export interface HistoryEntry {
  doc: unknown;
  selection: SnapshotSelection | unknown;
  reason: string;
  timestamp: number;
}
