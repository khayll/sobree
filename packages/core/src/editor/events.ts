import type { Range as ApiRange, InlinePosition, Selection } from "../doc/api";
import type {
  ChangePayload,
  EditorEvent,
  EditorEventPayload,
  KeyDownPayload,
  SelectionPayload,
  TrackChangesState,
  Unsubscribe,
} from "./types";

/**
 * The editor's observable event surface — `change`, `selection`,
 * `keydown`, `track-changes-change`. Owns the four listener sets and the
 * dispatch loops; the Editor keeps the *triggers* (the DOM listeners and
 * the commit pipeline) and forwards built payloads here. Each dispatch
 * isolates listener exceptions so one bad subscriber can't break the
 * others or the edit that fired the event.
 */
export class EditorEvents {
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

  on<E extends EditorEvent>(event: E, cb: (p: EditorEventPayload[E]) => void): Unsubscribe {
    const set = this.listeners[event] as Set<(p: EditorEventPayload[E]) => void>;
    set.add(cb);
    return () => set.delete(cb);
  }

  /** Whether any `change` subscriber exists — lets the caller skip
   *  building the (cloned) payload when nobody's listening. */
  hasChangeListeners(): boolean {
    return this.listeners.change.size > 0;
  }

  emitChange(payload: ChangePayload): void {
    dispatch(this.listeners.change, payload, "change");
  }

  /** Compose a {@link SelectionPayload} from `sel` and dispatch. */
  emitSelection(sel: Selection): void {
    if (this.listeners.selection.size === 0) return;
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
    dispatch(
      this.listeners.selection,
      { selection: sel, range, caret, block: caret?.block ?? null },
      "selection",
    );
  }

  /**
   * Normalise a DOM `KeyboardEvent` into a {@link KeyDownPayload} and
   * dispatch in registration order. Subscribers can `preventDefault()`
   * (browser default) and/or `stopPropagation()` (further subscribers).
   */
  emitKeyDown(e: KeyboardEvent): void {
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

  emitTrackChanges(state: TrackChangesState): void {
    dispatch(this.listeners["track-changes-change"], state, "track-changes-change");
  }

  /** Drop all subscribers on editor destroy. */
  clear(): void {
    this.listeners.change.clear();
    this.listeners.selection.clear();
    this.listeners.keydown.clear();
    this.listeners["track-changes-change"].clear();
  }
}

function dispatch<P>(set: Set<(p: P) => void>, payload: P, name: string): void {
  for (const cb of set) {
    try {
      cb(payload);
    } catch (err) {
      console.error(`[sobree] ${name} listener threw:`, err);
    }
  }
}
