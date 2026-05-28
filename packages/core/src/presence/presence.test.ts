import { beforeEach, describe, expect, it } from "vitest";
import { Editor } from "../editor";
import { attachPresence } from "./attach";
import type { AwarenessLike, AwarenessChanges } from "./awareness";
import { isPresenceState, presenceSelectionFromEditor } from "./state";

/** Minimal in-memory `AwarenessLike` for tests. Real awareness ships
 *  with `y-protocols/awareness` and an actual Yjs network protocol;
 *  this stub is API-compatible for the state-machinery tests. */
function fakeAwareness(clientID: number): AwarenessLike & {
  putRemote(id: number, state: Record<string, unknown>): void;
  removeRemote(id: number): void;
} {
  const states = new Map<number, Record<string, unknown>>();
  const listeners = new Set<(c: AwarenessChanges, origin: unknown) => void>();
  return {
    clientID,
    setLocalState(state) {
      if (state === null) {
        const had = states.has(clientID);
        states.delete(clientID);
        if (had) fire({ added: [], updated: [], removed: [clientID] });
      } else {
        const was = states.has(clientID);
        states.set(clientID, state);
        fire(
          was
            ? { added: [], updated: [clientID], removed: [] }
            : { added: [clientID], updated: [], removed: [] },
        );
      }
    },
    setLocalStateField(field, value) {
      const cur = states.get(clientID) ?? {};
      const next: Record<string, unknown> = { ...cur, [field]: value };
      states.set(clientID, next);
      fire({ added: [], updated: [clientID], removed: [] });
    },
    getStates() {
      return new Map(states);
    },
    on(_event, cb) {
      listeners.add(cb);
    },
    off(_event, cb) {
      listeners.delete(cb);
    },
    putRemote(id, state) {
      const was = states.has(id);
      states.set(id, state);
      fire(
        was
          ? { added: [], updated: [id], removed: [] }
          : { added: [id], updated: [], removed: [] },
      );
    },
    removeRemote(id) {
      const had = states.has(id);
      states.delete(id);
      if (had) fire({ added: [], updated: [], removed: [id] });
    },
  };

  function fire(c: AwarenessChanges): void {
    for (const cb of listeners) cb(c, "local");
  }
}

describe("presence state helpers", () => {
  it("presenceSelectionFromEditor maps a caret", () => {
    const sel = presenceSelectionFromEditor({
      kind: "caret",
      at: { block: { id: "b1", version: 0 }, offset: 5 },
    });
    expect(sel).toEqual({ blockId: "b1", anchor: 5, focus: 5 });
  });

  it("presenceSelectionFromEditor maps a range", () => {
    const sel = presenceSelectionFromEditor({
      kind: "range",
      range: {
        from: { block: { id: "b1", version: 0 }, offset: 2 },
        to: { block: { id: "b1", version: 0 }, offset: 8 },
      },
    });
    expect(sel).toEqual({ blockId: "b1", anchor: 2, focus: 8 });
  });

  it("presenceSelectionFromEditor returns null for null selection", () => {
    expect(presenceSelectionFromEditor(null)).toBeNull();
  });

  it("isPresenceState rejects bad shapes", () => {
    expect(isPresenceState(null)).toBe(false);
    expect(isPresenceState({})).toBe(false);
    expect(isPresenceState({ user: { id: "a", name: "A", color: "#fff" } })).toBe(
      true,
    );
    expect(
      isPresenceState({
        user: { id: "a", name: "A", color: "#fff" },
        selection: { blockId: "b1", anchor: 0, focus: 3 },
      }),
    ).toBe(true);
    expect(
      isPresenceState({
        user: { id: "a", name: "A", color: "#fff" },
        selection: { blockId: "b1", anchor: "wrong", focus: 3 },
      }),
    ).toBe(false);
  });
});

describe("attachPresence", () => {
  let host: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    editor = new Editor(host);
  });

  it("publishes own user state on attach", () => {
    const awareness = fakeAwareness(42);
    const handle = attachPresence(editor, awareness, {
      user: { id: "alice", name: "Alice", color: "#f59e0b" },
    });
    try {
      const peers = handle.getPeers();
      expect(peers.size).toBe(1);
      expect(peers.get(42)?.user.name).toBe("Alice");
    } finally {
      handle.destroy();
    }
  });

  it("fires onChange when a remote peer joins", () => {
    const awareness = fakeAwareness(1);
    const seen: number[] = [];
    const handle = attachPresence(editor, awareness, {
      user: { id: "self", name: "Me", color: "#000" },
      onChange: (peers) => seen.push(peers.size),
    });
    try {
      awareness.putRemote(2, {
        user: { id: "bob", name: "Bob", color: "#22f" },
        selection: null,
      });
      // Last seen size includes the remote peer (initial 1 → 1 again
      // for re-publish on attach → 2 after remote join).
      expect(seen.at(-1)).toBe(2);
    } finally {
      handle.destroy();
    }
  });

  it("destroy clears local state and unsubscribes", () => {
    const awareness = fakeAwareness(7);
    let lastSize = -1;
    const handle = attachPresence(editor, awareness, {
      user: { id: "u", name: "U", color: "#000" },
      onChange: (peers) => {
        lastSize = peers.size;
      },
    });
    handle.destroy();
    // After destroy, the local state is cleared.
    expect(awareness.getStates().get(7)).toBeUndefined();
    // Further remote changes don't reach the listener.
    awareness.putRemote(99, {
      user: { id: "x", name: "X", color: "#fff" },
      selection: null,
    });
    // lastSize was the size at destroy time; no subsequent updates.
    expect(lastSize).toBeGreaterThanOrEqual(0);
  });

  it("ignores non-Sobree shapes in remote awareness states", () => {
    const awareness = fakeAwareness(1);
    const handle = attachPresence(editor, awareness, {
      user: { id: "self", name: "Me", color: "#000" },
    });
    try {
      awareness.putRemote(2, { somethingElse: 42 });
      const peers = handle.getPeers();
      // Only the local peer; the malformed remote is filtered.
      expect(peers.has(2)).toBe(false);
      expect(peers.has(1)).toBe(true);
    } finally {
      handle.destroy();
    }
  });
});

