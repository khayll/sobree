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

## Page layout — `sobree.paperLayout`

`editor.renderedDocument` answers *content* questions ("what document
concept is this element?"). Its sibling `sobree.paperLayout` answers
*page-layout* questions about the paper stack — the page cards, gutters,
and header/footer zones the paginator builds. Plugins that position UI
(the `@sobree/block-tools` indicator/toolbar) or mount per-page chrome
(the `@sobree/review` comment gutter) use it instead of hardcoding the
`.paper*` page-DOM class names.

It lives on the `Sobree` façade (the paper stack is a Sobree concern, not
an Editor one), so reach it via the handle:

```ts
const layout = handle.sobree.paperLayout; // a PaperLayoutIndex
```

```ts
type PaperZone = "header" | "footer";

interface RenderedPaper {
  root: HTMLElement;        // the .paper page card (geometry / positioning anchor)
  commentSlot: HTMLElement; // per-page right-margin gutter — a plugin mount slot
}

interface PaperZoneMatch {
  zone: PaperZone;
  element: HTMLElement; // the .paper-header / .paper-footer container
}

interface PaperLayoutIndex {
  papers(): RenderedPaper[];
  nearestPaper(target: Element): HTMLElement | null;
  nearestZone(target: Element): PaperZoneMatch | null;
}
```

`papers()` enumerates every rendered page top-to-bottom; each carries its
page card and its `commentSlot` — the one sanctioned writable surface,
where a plugin appends per-page UI. `nearestPaper(target)` returns the
page card an element sits on (or `null` outside the stack).
`nearestZone(target)` reports whether an element is in a running header or
footer (`null` for body flow) — how `block-tools` distinguishes a
header/footer edit from a body edit.

The concrete implementation is exported as the `PaperLayout` class for
tests; embedders use `sobree.paperLayout`.

## Scope

These surfaces answer *"what document concept is this element?"* and
*"where does it sit on the page?"* — nothing more. They perform no
toolbar positioning, no accept/reject logic, no renderer mutation, and no
document writes — those stay in the plugins and the editor's edit API.
