import type { Editor } from "../editor";
import type { AwarenessLike, AwarenessChanges } from "./awareness";
import {
  type PresenceState,
  type PresenceUser,
  isPresenceState,
  presenceSelectionFromEditor,
} from "./state";

export interface AttachPresenceOptions {
  /** This peer's identity. Published in the local state's `user` field. */
  user: PresenceUser;
  /**
   * Called whenever any peer's presence (including this one) changes.
   * The map is `clientID → PresenceState` for every peer currently
   * publishing valid Sobree presence. The local peer's clientID
   * (matches `awareness.clientID` / `editor.ydoc.clientID`) is
   * included so callers can render their own caret too if they want.
   */
  onChange?: (peers: Map<number, PresenceState>) => void;
  /**
   * Default to `true` — publish the local user's selection on every
   * `editor.on("selection")` event. Pass `false` if the caller wants
   * to manage own-selection publishing manually.
   */
  publishOwnSelection?: boolean;
}

export interface PresenceHandle {
  /** Snapshot of every peer's current state, keyed by clientID. */
  getPeers(): Map<number, PresenceState>;
  /**
   * Push a manual state update. Useful when the local user changes
   * name / color, or to explicitly clear the selection on focus loss.
   */
  setLocalState(state: Partial<PresenceState>): void;
  /** Tear down: unsubscribe from awareness + editor events. Clears
   *  the local published state so peers see the user leave. */
  destroy(): void;
}

/**
 * Wire an `Awareness` instance into the editor.
 *
 * - Publishes the local user's `user` + `selection` state on every
 *   selection change.
 * - Subscribes to remote peers' state via awareness `"change"`
 *   events; surfaces them via `onChange(peers)` and `getPeers()`.
 *
 * Does NOT render an overlay — pass the peers to your own renderer,
 * or wire `attachPresenceOverlay` from this package for the default
 * caret + range-highlight rendering.
 *
 * Returns a `PresenceHandle` with manual-update and teardown.
 */
export function attachPresence(
  editor: Editor,
  awareness: AwarenessLike,
  opts: AttachPresenceOptions,
): PresenceHandle {
  const publishOwn = opts.publishOwnSelection ?? true;

  const initialState: PresenceState = {
    user: opts.user,
    selection: publishOwn
      ? presenceSelectionFromEditor(editor.selection.get())
      : null,
  };
  awareness.setLocalState(initialState as unknown as Record<string, unknown>);

  // Re-publish on selection change.
  let detachSelection: (() => void) | null = null;
  if (publishOwn) {
    detachSelection = editor.on("selection", () => {
      const sel = editor.selection.get();
      awareness.setLocalStateField(
        "selection",
        presenceSelectionFromEditor(sel) as unknown as Record<string, unknown> | null,
      );
    });
  }

  // Notify caller on every change.
  const peers = (): Map<number, PresenceState> => {
    const out = new Map<number, PresenceState>();
    for (const [id, state] of awareness.getStates()) {
      if (isPresenceState(state)) out.set(id, state);
    }
    return out;
  };

  const awarenessChangeListener = (_changes: AwarenessChanges) => {
    if (opts.onChange) opts.onChange(peers());
  };
  awareness.on("change", awarenessChangeListener);
  // Fire once initially so the caller sees the starting state.
  if (opts.onChange) opts.onChange(peers());

  return {
    getPeers: peers,
    setLocalState(patch: Partial<PresenceState>): void {
      if (patch.user !== undefined) {
        awareness.setLocalStateField(
          "user",
          patch.user as unknown as Record<string, unknown>,
        );
      }
      if ("selection" in patch) {
        awareness.setLocalStateField(
          "selection",
          patch.selection as unknown as Record<string, unknown> | null,
        );
      }
    },
    destroy(): void {
      awareness.off("change", awarenessChangeListener);
      detachSelection?.();
      awareness.setLocalState(null);
    },
  };
}
