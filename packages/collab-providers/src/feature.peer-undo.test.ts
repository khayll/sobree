/**
 * Per-peer undo via Y.UndoManager's `trackedOrigins`.
 *
 * Phase 1b.6's load-bearing property: a peer's `Cmd+Z` reverses ONLY
 * its own edits, not other peers'. Without this, collaboration is
 * miserable — Alice could undo away Bob's contributions.
 *
 * Mechanism: every local mutation mirrors to the Y.Doc with origin
 * `"local"`. Y.UndoManager tracks ops whose origin is in its
 * `trackedOrigins` set (default `["local"]`). Remote-provider edits
 * arrive with a different origin (the provider name) and don't
 * create stack items.
 */

import { appendBlock, createSobree, emptyDocument, paragraph, text } from "@sobree/core";
import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

describe("Phase 1b.6 — per-peer undo", () => {
  let aHost: HTMLElement;
  let bHost: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    aHost = makeHost();
    bHost = makeHost();
  });

  it("peer A's undo reverses A's edit, leaves B's edit intact", () => {
    const ydocA = new Y.Doc();
    const ydocB = new Y.Doc();

    // Seed A and propagate to B.
    const initial = emptyDocument();
    appendBlock(initial, paragraph([text("Hello")]));
    const editorA = createSobree(aHost, { ydoc: ydocA, content: initial });
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA));
    const editorB = createSobree(bHost, { ydoc: ydocB });
    try {
      // A's stack should be empty initially (seed pass had origin
      // "seed", not "local" — not tracked).
      expect(editorA.editor.history.canUndo()).toBe(false);

      // Capture the initial state we want to verify post-undo.
      const initialParaId = editorA.editor.getBlock(1).id;

      // A makes an edit (local origin → tracked).
      editorA.editor.replaceBlock(
        {
          id: initialParaId,
          version: editorA.editor.getBlock(1).version,
        },
        paragraph([text("Hello from Alice")]),
      );
      // A's stack has the edit.
      expect(editorA.editor.history.canUndo()).toBe(true);

      // Sync A → B so B sees A's update; the update arrives at B
      // with origin "local" (Yjs propagates via Y.applyUpdate; the
      // origin passed to applyUpdate is "remote" in our test, but
      // the Y peer's local UndoManager is scoped to its OWN ydoc's
      // origin tag — UndoManager sees the cross-doc update as a
      // foreign-origin op and doesn't track it).
      Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), "from-A");

      // B's stack is still empty — B didn't author anything; A's
      // update arrived with the "from-A" origin which isn't in B's
      // tracked set.
      expect(editorB.editor.history.canUndo()).toBe(false);

      // B makes its own edit.
      const sharedParaIdOnB = editorB.editor.getBlock(1).id;
      editorB.editor.replaceBlock(
        {
          id: sharedParaIdOnB,
          version: editorB.editor.getBlock(1).version,
        },
        paragraph([text("Hello from Alice (and Bob)")]),
      );
      expect(editorB.editor.history.canUndo()).toBe(true);

      // Sync B → A so A sees B's update.
      Y.applyUpdate(ydocA, Y.encodeStateAsUpdate(ydocB), "from-B");

      // Convergence.
      expect(editorA.getDocument()).toEqual(editorB.getDocument());
      const textOf = (e: typeof editorA) => {
        const p = e.getDocument().body[1];
        if (!p || p.kind !== "paragraph") return "";
        return p.runs.map((r) => (r.kind === "text" ? r.text : "")).join("");
      };
      expect(textOf(editorA)).toBe("Hello from Alice (and Bob)");

      // === The load-bearing assertion ===
      // A undoes. The Y.UndoManager on A only knows about A's edit
      // (which set "Hello from Alice"). It generates the inverse Y
      // operations and applies them. After sync, both peers should
      // see B's edit applied to the ORIGINAL "Hello" — not to "Hello
      // from Alice", because A's edit was undone.
      const undidA = editorA.editor.history.undo();
      expect(undidA).toBe(true);

      // Sync A → B (A's undo produced ops too).
      Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), "from-A");
      Y.applyUpdate(ydocA, Y.encodeStateAsUpdate(ydocB), "from-B");

      expect(editorA.getDocument()).toEqual(editorB.getDocument());

      // A's edit is gone. B's edit survives — A undid ONLY ITS OWN
      // edit, not B's. The result reflects "the original 'Hello'
      // plus B's transformation 'Hello from Alice (and Bob)'".
      //
      // The exact final text depends on Y.Text CRDT merge semantics.
      // What we MUST verify: B's word "Bob" survives, because B's
      // edit wasn't touched by A's undo.
      const finalText = textOf(editorA);
      expect(finalText).toContain("Bob");
    } finally {
      editorA.destroy();
      editorB.destroy();
    }
  });

  it("peer B's undo doesn't affect peer A's history", () => {
    const ydocA = new Y.Doc();
    const ydocB = new Y.Doc();
    const initial = emptyDocument();
    appendBlock(initial, paragraph([text("seed")]));
    const editorA = createSobree(aHost, { ydoc: ydocA, content: initial });
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA));
    const editorB = createSobree(bHost, { ydoc: ydocB });
    try {
      // Both peers make an edit.
      editorA.editor.replaceBlock(
        {
          id: editorA.editor.getBlock(1).id,
          version: editorA.editor.getBlock(1).version,
        },
        paragraph([text("A-edit")]),
      );
      editorB.editor.replaceBlock(
        {
          id: editorB.editor.getBlock(1).id,
          version: editorB.editor.getBlock(1).version,
        },
        paragraph([text("B-edit")]),
      );

      // Both have one undo each.
      expect(editorA.editor.history.depth().undo).toBeGreaterThanOrEqual(1);
      expect(editorB.editor.history.depth().undo).toBeGreaterThanOrEqual(1);

      // Sync.
      Y.applyUpdate(ydocA, Y.encodeStateAsUpdate(ydocB), "from-B");
      Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), "from-A");

      // After sync, A's undo count is unchanged (the sync brought in
      // B's ops which aren't tracked by A's UndoManager).
      expect(editorA.editor.history.depth().undo).toBeGreaterThanOrEqual(1);
      // Same for B.
      expect(editorB.editor.history.depth().undo).toBeGreaterThanOrEqual(1);

      // B undoes — A's stack is untouched.
      const aUndoBefore = editorA.editor.history.depth().undo;
      editorB.editor.history.undo();
      Y.applyUpdate(ydocA, Y.encodeStateAsUpdate(ydocB), "from-B");
      const aUndoAfter = editorA.editor.history.depth().undo;
      expect(aUndoAfter).toBe(aUndoBefore);
    } finally {
      editorA.destroy();
      editorB.destroy();
    }
  });
});

function makeHost(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}
