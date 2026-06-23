---
"@sobree/core": minor
"@sobree/block-tools": patch
"@sobree/review": patch
---

Centralize rendered-DOM lookup for plugins behind a typed `editor.renderedDocument` surface.

Plugins previously hardcoded the renderer's private DOM selectors
(`data-block-id`, `data-block-revision`, `ins[data-revision-author]`,
`.sobree-comment-range`, …) to map rendered elements back to document
concepts. That made the attribute names an undocumented inter-module
protocol duplicated across `@sobree/block-tools` and `@sobree/review`, so a
renderer rename silently broke plugins (AGENTS.md Rule 0).

`@sobree/core` now exposes `editor.renderedDocument` — a typed
`RenderedDocumentIndex` that answers "given a rendered element, what Sobree
document concept does it represent?" and the inverse: block lookup
(`elementForBlock` / `blockRefFromElement`), revision-mark discovery
(`revisionMarks` / `nearestRevisionMark`), and comment-range discovery
(`commentRanges` / `nearestCommentRange`). The protocol attribute/class
names now live in one core module that both the renderer (writer) and the
lookup (reader) import.

`block-tools` and `review` were migrated onto this surface; their behaviour
and the renderer's DOM output are unchanged (existing attributes remain for
CSS and tooling). Third-party plugins should use `editor.renderedDocument`
instead of querying renderer attributes directly.
