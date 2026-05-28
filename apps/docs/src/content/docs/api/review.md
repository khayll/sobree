---
title: "@sobree/review"
description: The review surface — per-author colour for tracked changes, hover popover with accept/reject, post-it comment cards.
---

`@sobree/review` is the **review surface** plugin. It doesn't own any
document state: it reads the AST and decorates the rendered DOM.
Removing the plugin removes the UI, not the data.

```sh
pnpm add @sobree/review
```

```ts
import { createSobree } from "@sobree/core";
import { review } from "@sobree/review";

createSobree(host, {
  content,
  plugins: [review()],
});
```

## What it layers on

`@sobree/core` ships **neutral** marks so a `.docx` with tracked
changes and comments always renders visibly — underlines for `ins`,
strikethroughs for `del`, dashed underline for format changes, a
trailing ¶ for paragraph-mark revisions, a faint yellow highlight for
comment ranges. The review plugin adds:

- **Per-author colour** on every revision mark and the matching
  paragraph-mark / format-change glyph. Authors are hashed to one of
  eight design-token colours (`--sobree-author-0..7`).
- **Hover popover** above tracked-change marks with accept ✓ /
  reject ✗ buttons. Works at all three revision levels (inline,
  paragraph, format) — the popover dispatches to the right editor
  method automatically.
- **Post-it comment cards** in the right-margin sidebar. Threaded
  (replies stack under their parent), vertically aligned to the
  commented range, with resolve / re-open toggles.

## Options

```ts
import { review, type ReviewOptions } from "@sobree/review";

review({
  showComments: true,   // default; false hides the sidebar cards
});
```

## How it stays in sync

Two event sources, debounced through a single `requestAnimationFrame`
plus a `setTimeout(100)` fallback (so the surface still updates if
the tab is hidden — `requestAnimationFrame` is paused there):

- `sobree.on("paginate", …)` — DOM was re-laid-out; positions are
  fresh.
- `sobree.on("change", …)` — document changed without a repagination
  (e.g. comment resolve, which only touches metadata).

On each refresh the plugin: (1) paints per-author colours via CSS
custom properties; (2) rebuilds the comment cards. The hover popover
resolves spans against `editor.getRevisions()` **live** on each
hover — no cache, so version mismatches can't develop.

## Customising author colours

Author colour comes from a fixed 8-slot palette in
`@sobree/core/tokens.css`. Override the tokens at any CSS scope:

```css
:root {
  --sobree-author-0: #1e88e5;
  --sobree-author-1: #43a047;
  /* …through --sobree-author-7 */
}
```

Or pin a specific author to a known colour by importing the helpers:

```ts
import { authorSlot, colorForAuthor } from "@sobree/review";

authorSlot("alice");         // → 0..7 (stable FNV hash)
colorForAuthor("alice");     // → "var(--sobree-author-3, #2ca02c)"
```

## DOM hooks

The plugin reads these attributes (all stamped by `@sobree/core`):

- `ins[data-revision-author]` / `del[data-revision-author]` — inline
  ins/del runs.
- `span.sobree-revision-format[data-revision-format-author]` —
  format-change wrappers.
- `[data-block-revision="ins"|"del"][data-block-revision-author]` —
  paragraphs whose paragraph mark is tracked.
- `.sobree-comment-range[data-comment-ids]` — commented text spans;
  the plugin places one card per top-level comment, aligned to the
  first range it sees on that paper.

It writes only inline CSS custom properties on those elements (e.g.
`--author-color`, `--sobree-block-revision-color`) so `destroy()` can
cleanly restore the neutral state.

## Together with the toolbar

`@sobree/block-tools` ships a track-changes pill (in the trailing
tools group, so it appears in every block-type toolbar) and an
optional author input that surfaces when the pill is on. Mount both
plugins side-by-side:

```ts
import { createSobree } from "@sobree/core";
import { review } from "@sobree/review";
import { blockTools } from "@sobree/block-tools";

createSobree(host, { plugins: [review(), blockTools()] });
```

See [the track-changes concept page](/concepts/track-changes/) for
the full feature walkthrough.
