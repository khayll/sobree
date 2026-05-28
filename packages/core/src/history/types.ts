/**
 * History config + depth shape. Phase 1b.6+ — backed by Y.UndoManager;
 * the snapshot-specific types (HistoryEntry, SnapshotPosition,
 * SnapshotSelection) that lived here in Phase 1a are no longer needed.
 */

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
