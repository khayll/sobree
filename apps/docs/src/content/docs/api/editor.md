---
title: Editor
description: The framework-free editor kernel — events, commands, mutations.
---

`Editor` is the kernel that mounts on a `contentEditable` host. `Sobree`
constructs one internally; you reach it via `sobree.editor`. Direct
construction is also fine when you want headless / non-paged usage.

## Construction

```ts
new Editor(host: HTMLElement, options?: EditorOptions);
```

```ts
interface EditorOptions {
  initialDocument?: SobreeDocument;
  changeDebounceMs?: number;                  // default 200
  contentHosts?: () => HTMLElement[];         // multi-host (paper stack uses this)
  /**
   * Y.Doc backing the document. If absent, the editor creates one
   * internally. Embedders pass their own when they want to attach a
   * Yjs provider (`y-websocket`, `y-indexeddb`, `y-webrtc`, …) for
   * persistence or collaboration. When supplied, the editor adopts
   * existing content (peer joining an active room) or seeds from
   * `initialDocument` when the Y.Doc is empty.
   */
  ydoc?: import("yjs").Doc;
  /**
   * Optional content-hashed BlobStore for binary parts.
   * Without one, image / font bytes ride inline in the Y.Doc's
   * `parts` map. With one, the editor hashes binary parts, uploads
   * the bytes to the store, and writes only the hash into the
   * Y.Doc's `partRefs` map — Y updates stay small regardless of
   * image size. See [BlobStore](/api/blob/).
   */
  blobStore?: import("@sobree/core").BlobStore;
}
```

## Sub-APIs

| name                 | what it is                                                     |
|----------------------|----------------------------------------------------------------|
| `editor.selection`   | Read / write selection in model terms.                         |
| `editor.table`       | Row / column / merge / split / per-cell ops.                   |
| `editor.commands`    | Named-command registry (see [plugin model](/concepts/plugins/)).|
| `editor.renderedDocument` | Typed DOM ↔ document-concept lookup for plugins (see [rendered-document lookup](/api/rendered-document/)). |

## Mutations

Every mutator takes a [`BlockRef`](/concepts/editing-model/#blockref) /
[`InlinePosition`](/concepts/editing-model/#inlineposition) /
[`Range`](/concepts/editing-model/#range) and returns an
[`EditResult<T>`](/concepts/editing-model/#editresult):

```ts
type EditResult<T> =
  | { ok: true;  value: T; affected: BlockRef[] }
  | { ok: false; error: EditError };
```

Errors don't throw. Stale `BlockRef` versions return
[`{ code: "optimistic-lock" }`](/concepts/editing-model/#editerror) — the
lock contract that lets external callers (LLM agents, automation, MCP)
survive concurrent edits. See the [editing model](/concepts/editing-model/)
for all of these types.

| method                            | what it does                                  |
|-----------------------------------|-----------------------------------------------|
| `replaceBlock(ref, block)`        | Replace one block.                            |
| `insertBlockBefore(ref, block)`   | Insert before.                                |
| `insertBlockAfter(ref, block)`    | Insert after.                                 |
| `deleteBlock(ref)`                | Remove. Auto-merges sections on `SectionBreak` removal. |
| `applyBlockProperties(refs, p)`   | Merge a properties patch into each target.    |
| `applyRunProperties(range, p)`    | Apply run properties (bold, color, …) to range.|
| `wrapRange(range, tag)`           | Apply a mark by tag (`strong`, `em`, …).      |
| `insertRun(at, run)`              | Insert an inline run.                         |
| `insertImage(at, bytes, opts)`    | Embed image bytes.                            |
| `deleteRange(range)`              | Delete inline range.                          |

Plus `*AtSelection` sugar (`setRunPropertiesAtSelection`,
`wrapSelection`, etc.) for in-process toolbar code that wants to read
the live DOM selection without building a `Range` itself.

`wrapRange` / `wrapSelection` take a `WrapTag` — `"strong" | "em" |
"u" | "s" | "sup" | "sub" | "mark"`. `applyRunProperties` takes a
`RunPropertiesPatch` (partial `RunProperties`; `null` clears a
property).

## Tables

`editor.table` is the table sub-API. Methods take the table's
`BlockRef` plus an options object and return `EditResult<BlockRef>`
like every other mutator:

| method | options type |
|---|---|
| `insertRow(ref, opts)` / `insertColumn(ref, opts)` | `InsertRowOpts` / `InsertColumnOpts` — where (`InsertAt`: `"start" \| "end" \| "before" \| "after"` + index) and what to copy. |
| `deleteRow(ref, index)` / `deleteColumn(ref, index)` | — |
| `mergeCells(ref, opts)` | `MergeCellsOpts` — the rectangular cell range to merge. |
| `setCellContent(cell, blocks)` / `setCellProperties(cell, …)` | `CellRef` — `{ table, row, col }` addressing one cell. |

## Marks (for toolbar / agent authors)

The mark layer is data, not hard-coded UI — the same catalogue drives
the stock toolbar, the keyboard plugin, and any custom surface:

| export | role |
|---|---|
| `MARK_COMMAND_DEFS` | The catalogue: one `MarkCommandDef` per toggleable mark (`ToggleableMark` tag, command name, run property). |
| `MARK_PROP` / `MARK_ON` | Tag → `RunProperties` key, and the value that means "on" (`bold` → `true`, etc.). |
| `toggleMark(editor, range, tag)` | Toggle a mark over a range. Registered on the bus as `mark.toggle.*` by the Editor itself. |
| `isMarkActive(editor, range, tag)` | Is the mark on across the range? — drives pressed-state in toolbars. |
| `rangeAtSelection(editor)` | The current DOM selection as an API `Range`. |

## Track changes

The editor has a session-wide track-changes mode. When on, every
authoring mutation above produces a tracked revision instead of a
direct edit — same API surface, different semantics.

```ts
editor.setTrackChanges({ enabled: true, author: "alice" });
editor.getTrackChanges();   // → { enabled, author? }
editor.on("track-changes-change", state => /* … */);
```

The consumption side mirrors the three revision levels Sobree
distinguishes:

| level | accept | reject |
|---|---|---|
| inline | `acceptRevision(range)` | `rejectRevision(range)` |
| paragraph mark | `acceptParagraphRevision(blockRef)` | `rejectParagraphRevision(blockRef)` |
| format change | `acceptFormatRevision(range)` | `rejectFormatRevision(range)` |
| all | `acceptAllRevisions({ author? })` | `rejectAllRevisions({ author? })` |
| query | `getRevisions(): RevisionSpan[]` (each carries `level`) | |

See [Track changes](/concepts/track-changes/) for the full feature
walkthrough including keystroke routing, DOCX round-trip, and the
review-plugin UI.

## Events

```ts
editor.on("change",                ({ doc, revision, documentVersion }) => /* … */);
editor.on("selection",             ({ selection, range, caret, block }) => /* … */);
editor.on("keydown",               (payload) => /* { key, ctrl, shift, alt, meta, preventDefault, … } */);
editor.on("track-changes-change",  (state) => /* { enabled, author? } */);
```

The editor fires `keydown` on every host key press but binds **zero**
shortcuts itself. The keyboard plugin maps keys to commands; replace it
or skip it as you like.

Event names are the `EditorEvent` union; payloads are
`EditorEventPayload[E]` — `ChangePayload` (`{ doc, revision,
documentVersion }`), `SelectionPayload`, `KeyDownPayload`, and
`TrackChangesState` respectively. `on(...)` returns an `Unsubscribe`
function.

## Commands

`editor.commands` is a named-command registry: plugins register
`CommandDefinition`s and any surface executes them by name —
`editor.commands.execute("mark.toggle.bold")`. `list()` returns
`CommandSnapshot[]` (`{ name, title, isActive, isAvailable }`) for
everything registered — how generic surfaces (command palettes, MCP
tool catalogues) discover what's available. `ApiRangeType` is an alias
of the editing-model `Range` for consumers that import types only.

## Reads

| method                            | returns           |
|-----------------------------------|-------------------|
| `getDocument()`                   | `SobreeDocument`  |
| `getRevision()`                   | `number`          |
| `getDocumentVersion()`            | `number`          |
| `getBlocks()`                     | `BlockInfo[]`     |
| `getBlock(index)`                 | `BlockInfo`       |
| `getBlockById(id)`                | `BlockInfo \| null`|
| `getOutline()`                    | `OutlineItem[]`   |
| `toHtml()`                        | `string`          |
