/**
 * Awareness state shapes used by Sobree's presence layer.
 *
 * The Yjs Awareness protocol gives each peer a `Map<clientID, state>`
 * with arbitrary JSON values. Sobree standardizes on the shape below
 * so plugins from different vendors can render compatible overlays.
 *
 * Wire snippet:
 *
 * ```ts
 * awareness.setLocalState({
 *   user: { id: "alice", name: "Alice", color: "#f59e0b" },
 *   selection: { blockId: "1f3a_2", anchor: 4, focus: 12 },
 * });
 * ```
 */

import type { Selection as EditorSelection } from "../doc/api";

/** Per-peer state published to other peers via Yjs awareness. */
export interface PresenceState {
  user: PresenceUser;
  /**
   * Where this peer's cursor / range sits. `null` if focus left the
   * editor. Position is identified by `blockId` (stable across the
   * Y.Doc — see `BlockRegistry`) + character offsets, so it survives
   * re-pagination and structural mutations.
   */
  selection: PresenceSelection | null;
}

export interface PresenceUser {
  /** Stable peer id (a UUID, an auth user id, etc). Random per page-load
   *  is fine if you don't have auth. */
  id: string;
  /** Display name for overlays / tooltips. */
  name: string;
  /** CSS color for the caret / range highlight (e.g. "#f59e0b"). */
  color: string;
}

export interface PresenceSelection {
  /** BlockRegistry id of the focused block. Both `anchor` and `focus`
   *  point inside this block (cross-block selections are clipped to
   *  the focus block for the overlay). */
  blockId: string;
  /** Caret position when anchor === focus; range start otherwise. */
  anchor: number;
  /** Caret position when anchor === focus; range end otherwise. */
  focus: number;
}

/** Convenience view: the editor's live `Selection` collapsed to a
 *  `PresenceSelection` referencing the focused block by id. */
export function presenceSelectionFromEditor(
  sel: EditorSelection,
): PresenceSelection | null {
  if (!sel) return null;
  if (sel.kind === "caret") {
    return {
      blockId: sel.at.block.id,
      anchor: sel.at.offset,
      focus: sel.at.offset,
    };
  }
  // range — use the focus (`to`) block as the anchor; clip the
  // selection to within that block.
  const focusBlock = sel.range.to.block;
  const sameBlock = sel.range.from.block.id === focusBlock.id;
  return {
    blockId: focusBlock.id,
    anchor: sameBlock ? sel.range.from.offset : sel.range.to.offset,
    focus: sel.range.to.offset,
  };
}

/** Type guard — narrows an unknown awareness state value to PresenceState. */
export function isPresenceState(value: unknown): value is PresenceState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!v.user || typeof v.user !== "object") return false;
  const u = v.user as Record<string, unknown>;
  if (typeof u.id !== "string" || typeof u.name !== "string" || typeof u.color !== "string") {
    return false;
  }
  if (v.selection !== null && v.selection !== undefined) {
    if (typeof v.selection !== "object") return false;
    const s = v.selection as Record<string, unknown>;
    if (typeof s.blockId !== "string") return false;
    if (typeof s.anchor !== "number") return false;
    if (typeof s.focus !== "number") return false;
  }
  return true;
}
