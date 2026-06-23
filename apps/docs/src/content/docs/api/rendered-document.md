---
title: Rendered-document lookup
description: Typed bridge between rendered DOM elements and document concepts.
---

`editor.renderedDocument` is the sanctioned way for plugins to map
between the **rendered DOM** and **document concepts** — blocks,
tracked-change marks, and comment ranges. It answers one question in
both directions:

> Given an element in the rendered page, what Sobree document concept
> does it represent? — and: where is the element for this concept?

The renderer stamps identity onto the DOM (block ids, revision markers,
comment-range highlights) as an implementation detail. Plugins should
**not** query those attributes directly: hardcoding the renderer's
selector strings couples every plugin to the renderer's private DOM
shape, so a rename silently breaks them (see AGENTS.md Rule 0). Going
through `editor.renderedDocument` keeps that selector knowledge in one
place inside `@sobree/core`.

The stock `@sobree/block-tools` and `@sobree/review` plugins are built
on this surface; third-party plugins should use it too.

## Access

```ts
const rd = editor.renderedDocument; // on the core Editor
// On a createSobree() handle: handle.editor.renderedDocument
```

## Block lookup — `RenderedBlockLookup`

```ts
interface RenderedBlockLookup {
  elementForBlock(ref: BlockRef): HTMLElement | null;
  elementForBlockId(blockId: string): HTMLElement | null;
  blockRefFromElement(element: Element): BlockRef | null;
  blockIdFromElement(element: Element): string | null;
}
```

`blockRefFromElement` walks up from any nested element to the containing
block and returns a live, versioned `BlockRef` (the version comes from
the editor's block registry). `elementForBlock` / `elementForBlockId`
re-resolve a block's element after a commit rebuilds the body — the
pattern the floating toolbar uses to stay anchored.

## Revision discovery — `RenderedRevisionLookup`

```ts
type RenderedRevisionKind = "inline-insert" | "inline-delete" | "paragraph" | "format";

interface RenderedRevisionMark {
  kind: RenderedRevisionKind;
  element: HTMLElement;
  author?: string;
  date?: string;
  blockRef?: BlockRef;
}

interface RenderedRevisionLookup {
  revisionMarks(root?: ParentNode): RenderedRevisionMark[];
  nearestRevisionMark(target: Element): RenderedRevisionMark | null;
}
```

`revisionMarks()` returns every tracked-change mark (defaulting to the
whole document, or scoped to `root`). `nearestRevisionMark(target)`
resolves the most-specific mark at a pointer — inline beats format beats
paragraph, matching the renderer's wrapper nesting, so an inserted +
format-changed run resolves to its `ins` / `del`.

## Comment discovery — `RenderedCommentLookup`

```ts
interface RenderedCommentRange {
  element: HTMLElement;
  commentIds: string[];
  blockRef?: BlockRef;
}

interface RenderedCommentLookup {
  commentRanges(root?: ParentNode): RenderedCommentRange[];
  nearestCommentRange(target: Element): RenderedCommentRange | null;
}
```

A single range can anchor more than one comment (overlapping ranges), so
`commentIds` is an array.

## Combined surface — `RenderedDocumentIndex`

`editor.renderedDocument` is a `RenderedDocumentIndex`, the union of the
three lookups above:

```ts
interface RenderedDocumentIndex
  extends RenderedBlockLookup, RenderedRevisionLookup, RenderedCommentLookup {}
```

The concrete implementation is exported as the `RenderedDocument` class
for headless tests; embedders normally just use `editor.renderedDocument`.

## Scope

This surface answers *"what document concept is this element?"* and
nothing more. It performs no toolbar positioning, no accept/reject
logic, no renderer mutation, and no document writes — those stay in the
plugins and the editor's edit API.
