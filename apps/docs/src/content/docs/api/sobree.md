---
title: Sobree
description: The façade — composes editor, paper stack, and default plugins.
---

`Sobree` is the editor façade — it composes the framework-free `Editor`,
the paginated paper stack, and the default plugins behind one constructor.

:::tip
For most embedders the blessed entry point is **[`createSobree()`](/api/create-sobree/)** —
it wraps `Viewport` + `Sobree` + `BlockTools` into a single call and
returns a flat handle. This page documents the underlying class for
embedders who need to wire things up themselves.
:::

## Constructor

```ts
new Sobree(container: HTMLElement, options?: SobreeOptions);
```

```ts
interface SobreeOptions {
  initialDocument?: SobreeDocument;          // built or imported
  pageSetup?: PageSetup;                     // overrides doc-derived setup
  changeDebounceMs?: number;                 // default 200
  /**
   * Y.Doc backing the document. Optional — if absent, the editor
   * creates one internally. Embedders pass their own when they want
   * to attach a Yjs provider (`y-websocket`, `y-indexeddb`,
   * `y-webrtc`, …) for persistence or collaboration. Forwarded to
   * the underlying Editor.
   */
  ydoc?: import("yjs").Doc;
  /**
   * Optional content-hashed BlobStore for binary parts.
   * Without one, image / font bytes ride inline in the Y.Doc; with
   * one, the editor uploads bytes to the store and writes only
   * hashes into the Y.Doc. See [BlobStore](/api/blob/).
   */
  blobStore?: import("@sobree/core").BlobStore;
}
```

`Sobree` itself does **not** mount any user plugins — that's
[`createSobree()`](/api/create-sobree/)'s job. Direct constructors
mount plugins manually (see "Plugin slot" below).

## Properties

| name              | type                | what it is                                       |
|-------------------|---------------------|--------------------------------------------------|
| `editor`          | `Editor`            | The framework-free editor kernel.                |
| `stackRoot`       | `HTMLElement`       | The paper stack's outer element.                 |
| `firstPaper`      | `HTMLElement`       | First `<paper>` — useful for viewport fit.       |

## Methods

| name                                | returns               | what it does                                          |
|-------------------------------------|-----------------------|-------------------------------------------------------|
| `getMode()`                         | `SobreeMode`          | `"edit" \| "read"` — current mode.                    |
| `setMode(mode)`                     | `void`                | Toggle edit / read; flips `contenteditable`.          |
| `getPageSetup()`                    | `PageSetup`           | Section-0 page setup (JSON-clean).                    |
| `setPageSetup(partial)`             | `void`                | Merge into section-0 setup; triggers repagination.    |
| `getSectionCount()`                 | `number`              | Number of sections in the doc.                        |
| `getSectionSetup(index)`            | `PageSetup`           | Section `index` projected onto `PageSetup`.           |
| `setSectionSetup(index, partial)`   | `void`                | Write back to section `index`.                        |
| `getPageCount()`                    | `number`              | Rendered page count.                                  |
| `repaginate()`                      | `void`                | Force a repagination pass.                            |
| `getOutline()`                      | `OutlineItem[]`       | Heading outline for a TOC.                            |
| `openDocx(src)`                     | `Promise<void>`       | Replace document from `.docx` bytes / File / Blob.    |
| `exportDocx()`                      | `Blob`                | Serialise current document to `.docx`.                |
| `setRenderTier(tier)`               | `void`                | Deprecated, inert — render tiers are retired (see [Viewport](/api/viewport/)). |
| `destroy()`                         | `void`                | Tear down editor, plugins, paper stack.               |

## Track changes

The façade proxies the editor's track-changes API so embedders don't
have to reach `sobree.editor`:

```ts
sobree.setTrackChanges({ enabled: true, author: "alice" });
sobree.getTrackChanges();   // → { enabled, author? }
```

See [Track changes](/concepts/track-changes/) for the feature
overview and [`@sobree/review`](/api/review/) for the UI plugin
(per-author colour, popover, comment cards).

## Events

```ts
sobree.on("change",                ({ doc, revision }) => /* … */);
sobree.on("paginate",              ({ pageCount }) => /* … */);
sobree.on("setup",                 ({ setup }) => /* … */);
sobree.on("mode-change",           ({ mode }) => /* … */);
sobree.on("track-changes-change",  (state) => /* { enabled, author? } */);
sobree.on("docx:import",           ({ warnings }) => /* … */);
sobree.on("docx:export",           ({ warnings }) => /* … */);
```

Each `on(...)` returns an unsubscribe.

## Plugin slot

`Sobree` itself only mounts the always-on `attachSections` plugin
internally. Stock optional plugins (toolbar, keyboard, zoom dock) live
in sibling packages and are mounted by
[`createSobree()`](/api/create-sobree/) — not by `Sobree` directly. If
you instantiate `Sobree` yourself, mount them manually using each
package's direct-construction surface:

```ts
import { Sobree } from "@sobree/core";
import { BlockTools } from "@sobree/block-tools";
import { attachKeyboard } from "@sobree/keyboard";

const sobree = new Sobree(host);

// Optional UI / shortcuts:
const tools = new BlockTools({
  stackRoot: sobree.stackRoot,
  editor: sobree.editor,
  renderingArea: host,
  getSetup: () => sobree.getPageSetup(),
  setSetup: (next) => sobree.setPageSetup(next),
});
const detachKeyboard = attachKeyboard(sobree.editor);

// Anything custom — your code subscribes directly:
const offChange = sobree.on("change", ({ doc }) => /* … */);
```

Tear down on `destroy()`:

```ts
offChange();
detachKeyboard();
tools.destroy();
sobree.destroy();
```

For the more ergonomic plugin-array path, use
[`createSobree()`](/api/create-sobree/) instead — it owns the
`SobreePlugin` lifecycle for you.

## Advanced: PaperStack

`Sobree` composes the `Editor` with a `PaperStack` — the paginated page
renderer (one `Paper` per page; pagination, headers/footers, anchored
frames). Both classes are exported for shells that need to compose
them differently than `Sobree` does, but the stack's contract is
otherwise internal: drive it through `Sobree` (`setPageSetup`,
`paginate` events) rather than calling it directly.
