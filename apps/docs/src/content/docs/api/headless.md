---
title: HeadlessSobree
description: A no-DOM Sobree peer for LLM agents, automation, MCP servers.
---

`HeadlessSobree` is the editor without the editor — no `contentEditable`,
no rendering, no selection-from-DOM logic. Just a Y.Doc, the same
mutation API the browser `Editor` exposes, the same per-peer undo,
and the same `change` event. For Node-side code that needs to
participate in a Sobree document as a peer.

```ts
import * as Y from "yjs";
import { HeadlessSobree, paragraph, text } from "@sobree/core";

const ydoc = new Y.Doc();
const sobree = new HeadlessSobree(ydoc, { origin: "agent" });

const block = sobree.getBlock(0);
sobree.replaceBlock(
  { id: block.id, version: block.version },
  paragraph([text("Hello from a headless peer.")]),
);
```

## When to use it

- **LLM agents.** Connect a Y provider to a Sobree room; the LLM
  sees the same Y.Doc the user sees. It reads structure, applies
  edits, observes the human's changes — same primitives as a
  browser editor, no display.
- **Server-side automation.** Cron jobs, webhooks, ingestion
  pipelines that produce formatted documents and write them to a
  Sobree-backed store.
- **Server-side export / rendering.** Load a snapshot from
  `@sobree/collab-server`'s persistence, project it, call
  `editor.toDocx()`-equivalent (via the same DOCX helpers).
- **Tests.** Build fixture documents programmatically without a DOM.

## Signature

```ts
class HeadlessSobree {
  constructor(ydoc: Y.Doc, options?: HeadlessSobreeOptions);

  readonly ydoc: Y.Doc;
  readonly commands: CommandBus;
  readonly history: History;
  readonly table: TableApi; // same granular table surface as `editor.table`
  readonly origin: string;

  // Reads
  getDocument(): SobreeDocument;
  getBlocks(): BlockInfo[];
  getBlock(index: number): BlockInfo;
  getBlockById(id: string): BlockInfo | null;
  getOutline(): OutlineItem[];
  getSelection(): Selection;
  setSelection(selection: Selection): void;

  // Mutations
  setDocument(doc: SobreeDocument): void;
  replaceBlock(target: BlockRef, block: Block): EditResult<BlockRef>;
  insertBlockBefore(target: BlockRef, block: Block): EditResult<BlockRef>;
  insertBlockAfter(target: BlockRef, block: Block): EditResult<BlockRef>;
  deleteBlock(target: BlockRef): EditResult<void>;
  applyBlockProperties(
    targets: BlockRef[],
    patch: ParagraphPropertiesPatch,
  ): EditResult<void>;

  // Events + lifecycle
  // event: HeadlessEvent ("change"); returns a HeadlessUnsubscribe
  on(event: "change", cb: (p: HeadlessChangePayload) => void): HeadlessUnsubscribe;
  destroy(): void;
}

interface HeadlessSobreeOptions {
  origin?: string;           // Default "headless"
  initialDocument?: SobreeDocument;
  idPrefix?: string;
}

interface HeadlessChangePayload {
  doc: SobreeDocument;
  local: boolean;  // true = this peer's edit; false = received from a remote peer
}
```

## Construction — adopt vs seed

Same logic the browser `Editor` uses:

- **Y.Doc is empty** → `HeadlessSobree` seeds it from
  `options.initialDocument` (or an empty doc).
- **Y.Doc has content** (a peer joining an active room) → adopts the
  existing state. `initialDocument` is ignored.

This means you can do either:

```ts
// Path A: seed from a fresh doc.
const ydoc = new Y.Doc();
const sobree = new HeadlessSobree(ydoc, {
  initialDocument: docFromMyApp,
});

// Path B: join an existing room — provider syncs first, then construct.
const ydoc = new Y.Doc();
const provider = new WebsocketProvider("ws://…", "room-id", ydoc);
await new Promise((r) => provider.once("sync", r));
const sobree = new HeadlessSobree(ydoc);
```

## Origin tagging

Every mutation writes to the Y.Doc with `options.origin` as the
transaction origin (default `"headless"`). Two consequences:

1. **Y.UndoManager is scoped to this origin.** `sobree.history.undo()`
   reverses only mutations this peer made. The human peers' edits
   pass through but don't land on the local undo stack.
2. **Other peers can identify the source.** Their `change` event sees
   `local: false` and the underlying Y transaction's `origin` field
   carries this peer's tag. Useful for "edited by AI" attribution.

Use a stable per-peer origin for telemetry:

```ts
new HeadlessSobree(ydoc, { origin: `agent:${process.env.LLM_MODEL}` });
```

## Mutations

Each method mirrors the browser `Editor`'s equivalent:

- **`replaceBlock(target, block)`** — swap in a new `Block`. If the
  block being replaced was a `section_break` and the replacement
  isn't, the surrounding sections merge.
- **`insertBlockBefore / insertBlockAfter`** — splice a new block in.
- **`deleteBlock`** — remove a block. If you delete the last block,
  an empty paragraph takes its place.
- **`applyBlockProperties(targets, patch)`** — merge a property
  patch into one or more paragraphs. `undefined` in the patch
  removes a field; everything else overwrites.
- **`table.*`** — the same granular table surface as `editor.table`
  (`insertRow` / `deleteRow` / `insertColumn` / `deleteColumn`,
  `mergeCells` / `unmergeCell`, `setCellContent` / `setCellProperties`,
  `setColumnWidth` / `toggleHeaderRow` / `setProperties`). So an agent
  styles a cell or adds a row without rebuilding the whole `Table`. Each
  op still round-trips the whole table block under the hood and inherits
  the same optimistic-lock check.
- **`setDocument(doc)`** — wholesale replace. Use for `loadDocx`-
  style "open a different document" flows. Loses the current
  document's CRDT identity — all blocks are fresh, no merging.

All mutation methods return an
[`EditResult<T>`](/concepts/editing-model/#editresult) — either
`{ ok: true, value, affected }` or `{ ok: false, error: EditError }`.
Optimistic locking via [`BlockRef.version`](/concepts/editing-model/#blockref)
works the same as in the browser editor. See the
[editing model](/concepts/editing-model/) for `BlockRef`,
`InlinePosition`, `Range`, `Selection`, and `EditResult`.

## What's not exposed

`HeadlessSobree` covers block-level and table mutations. The richer
**range-based** surface — inline edits addressed by character offset —
lives on the browser `Editor` and is not mirrored here:

- `applyRunProperties(range, patch)` — apply run marks to a range
- `wrapRange(range, tag)`
- `insertRun(at, run)` / `insertImage(at, bytes, opts)`
- `deleteRange(range)`

For these, an agent can drop down to direct Y.Doc manipulation OR
build a new block by hand and pass it to `replaceBlock`. The MCP
wrapper ([`@sobree/mcp`](/api/mcp/)) exposes the block-level surface
and does not cover these range mutations either.

## Examples

### Observing remote edits

```ts
const sobree = new HeadlessSobree(ydoc);
sobree.on("change", ({ doc, local }) => {
  if (local) return;  // ignore our own edits
  console.log("human typed; new state:", doc.body.length, "blocks");
});
```

### Per-peer undo

```ts
const sobree = new HeadlessSobree(ydoc, { origin: "agent" });
// Make some edits…
sobree.history.undo();   // reverses ONLY this peer's edits
                         // human peers' work is untouched
```

### Loopback for tests

```ts
import { loopback } from "@sobree/collab-providers";
import { HeadlessSobree } from "@sobree/core";

const { a, b } = loopback();
const peerA = new HeadlessSobree(a);
const peerB = new HeadlessSobree(b);
// Edits to a propagate to b and vice versa, in-memory.
```

## Related

- [Architecture: deployment tiers](/concepts/architecture/#deployment-tiers)
- [`@sobree/collab-providers`](/api/collab-providers/) — Y providers to connect peers
- [`@sobree/collab-server`](/api/collab-server/) — the multi-peer relay
- [Y.Doc + collaboration](/api/create-sobree/#ydoc--collaboration) — the underlying Y.Doc model
