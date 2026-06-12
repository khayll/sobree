---
title: Y.Doc wire API
description: Seed, project, and diff-apply a SobreeDocument against a Y.Doc.
---

The document is backed by a Y.Doc — **the Y.Doc is the wire**: attach a
Yjs provider and edits propagate as Y-protocol updates, no separate RPC
layer. These three functions are the blessed wire-level contract for
code that handles a Sobree Y.Doc *outside* an `Editor` /
`HeadlessSobree` instance (server-side previews, importers, migration
jobs):

| function | what it does |
|---|---|
| `seedYDoc(ydoc, doc, ids)` | Populate a **fresh** Y.Doc from a `SobreeDocument` + stable block ids. Transacts with origin `"seed"` so a local-origin UndoManager ignores it. |
| `projectYDoc(ydoc)` | The inverse — `{ doc, ids, partRefs }` projected from the live Y.Doc. What a peer renders after joining. |
| `applyDocumentToYDoc(ydoc, doc, ids, origin?, opts?)` | Diff-apply a full document onto an existing Y.Doc, preserving CRDT character identity where text survives (collaborative cursors don't jump). |

```ts
import * as Y from "yjs";
import { seedYDoc, projectYDoc, parseMarkdown } from "@sobree/core";

const ydoc = new Y.Doc();
const doc = parseMarkdown("# Hello");
seedYDoc(ydoc, doc, doc.body.map((_, i) => `b${i}`));

// …ship updates over any Y provider; later, anywhere:
const { doc: projected } = projectYDoc(ydoc);
```

Anything finer-grained — the Y map/array schema keys, per-block
builders, the Run↔Delta conversion — is deliberately **not** exported:
it would couple your code to the Y.Doc layout, which only
`@sobree/core` owns (and migrates). If these three can't express what
you need, that's an issue to open, not an internal to import.

Inside an editor you rarely need any of this: `editor.ydoc` is live and
every mutation mirrors automatically (see
[createSobree → Y.Doc + collaboration](/api/create-sobree/)).
