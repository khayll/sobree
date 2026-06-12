---
title: History (undo / redo)
description: Per-peer undo via Y.UndoManager.
---

`editor.history` is a thin wrapper around `Y.UndoManager`.
It observes the editor's backing Y.Doc — `body`, `meta`, and `parts`
top-level types — and creates an undo stack entry for every locally-
authored mutation.

## Per-peer undo (the load-bearing collab property)

In a collaborative session, Alice's `Cmd+Z` reverses **only Alice's
own edits**. Bob's edits flow through the Y.Doc with a different
origin and don't enter Alice's undo stack.

The mechanism: every local mutation mirrors into the Y.Doc with origin
`"local"`. Y.UndoManager's `trackedOrigins` is set to `["local"]`, so
only those operations produce stack items. Remote-provider edits arrive
with the provider's own origin and pass through unrecorded.

## API

```ts
interface History {
  undo(): boolean;        // returns false if stack empty
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Drop both undo and redo stacks. */
  clear(): void;
  /** Current depth — useful for toolbar badges. */
  depth(): { undo: number; redo: number };
  /** Subscribe to depth changes. */
  on(event: "change", cb: (depth: { undo: number; redo: number }) => void): () => void;
}
```

Access via `editor.history` (where `editor` is an `Editor` — i.e.
`editor.editor.history` on the `createSobree()` handle).

Exported companions: `HistoryDepth` is the `{ undo, redo }` shape,
`HistoryEvent`/`HistoryListener` type the `on("change", …)`
subscription, and `HistoryConfig` / `DEFAULT_HISTORY_CONFIG` hold the
capture-timeout configuration for direct `History` construction in
headless tests.

## Bus commands

Two commands registered by the Editor itself (always available, even
when the keyboard plugin isn't mounted):

| name             | what it does       |
| ---------------- | ------------------ |
| `history.undo`   | Same as `history.undo()` |
| `history.redo`   | Same as `history.redo()` |

```ts
editor.commands.execute("history.undo");
editor.commands.execute("history.redo");
```

## What gets recorded

| Source of change | On the local undo stack? |
| ---------------- | ------------------------ |
| Toolbar click (`replaceBlock`, `applyRunProperties`, etc.) | Yes — origin `"local"` |
| Typing (`input` / `beforeinput`) | Yes — coalesced into typing-session steps |
| `setDocument(doc)` / `loadMarkdown` / `loadDocx` | Yes |
| `embedFont()` | Yes (font bytes do live on the Y.Doc, so undo restores them) |
| Remote peer edits (via provider) | **No** — different origin |
| The initial seed (constructor population) | No — origin `"seed"` |
| Selection-only changes (caret movement) | No |

## Typing-session coalescing

A burst of keystrokes collapses into a single undo step. Y.UndoManager's
`captureTimeout` (default `1000ms`, configurable via
`History`'s `coalesceIdleMs` option) controls the window. Operations
inside the window merge into the open stack item; a pause longer than
`captureTimeout` starts a new step.

## Selection restoration

Selection is captured in `stackItem.meta` when each stack item is
added, and restored on `stack-item-popped`. Because Y.Doc updates
preserve block-id stability across undo (the UndoManager re-inserts
the original Y.Map identities), id-keyed selections survive the
undo/redo cycle without index translation.

## Edge cases

- **`embedFont()` / `loadDocx()`** — both go through the same
  Y.Doc-mirror path, so they record as one undo step each. Call
  `editor.editor.history.clear()` if you want a load to wipe history.
- **`pruneUnusedParts()`** — undoable; the pruned bytes are still
  recoverable from Y.UndoManager's internal struct list.

## Examples

### Toolbar undo button

```ts
const button = document.querySelector("button.undo")!;
const sync = ({ undo }: { undo: number; redo: number }) => {
  button.disabled = undo === 0;
};
editor.history.on("change", sync);
sync(editor.history.depth());
button.addEventListener("click", () => editor.history.undo());
```

### Pre-load history wipe

```ts
async function openDocument(file: File) {
  await editor.loadDocx(file);
  editor.editor.history.clear(); // discard the load itself + everything before
}
```

### Mixed AST + typing scenario

```ts
// 1. user types "Hello world"           → 1 entry (typing-session)
// 2. user pauses 1.5s                   → captureTimeout fires; step closes
// 3. user types " more"                 → 1 entry
// 4. user clicks Bold on the selection  → 1 entry (commit-driven)
// 5. user presses Cmd+Z                 → undoes the Bold
// 6. Cmd+Z                              → undoes " more"
// 7. Cmd+Z                              → undoes "Hello world"
```

### Collaborative session

```ts
// Alice and Bob are editing the same Y.Doc through y-websocket.

// Bob types " from Bob" → Bob's stack has 1 entry; Alice's stack
// has 0 (Bob's edits arrive with the provider origin, not "local").
// Alice's Cmd+Z is a no-op (canUndo() === false).

// Alice types "Hello" → Alice's stack has 1 entry.
// Alice's Cmd+Z → undoes Alice's "Hello"; Bob's " from Bob" stays.
```

## Related

- [`createSobree()`](/api/create-sobree/) — undo/redo are auto-wired here
- [Plugin model](/concepts/plugins/)
- [`@sobree/keyboard`](/api/keyboard/) — Cmd+Z key binding
