---
title: Track changes
description: How Sobree records, surfaces, and resolves tracked revisions — for live typing, API authoring, and DOCX round-trip.
---

Sobree implements Word-style **track changes** end-to-end: a single
mode flag turns every authoring path — keystrokes, paste, IME
composition, API calls — into tracked revisions, and a uniform
consumption API (`accept` / `reject` at three levels) drains them back
out. Revisions round-trip through `.docx` so they survive save→reopen
cycles between Sobree, Word, LibreOffice, and Google Docs.

## The mode

```ts
sobree.setTrackChanges({ enabled: true, author: "Alice" });
// …user types, pastes, runs the API: every authored mutation lands
// as a revision marker attributed to Alice.

sobree.setTrackChanges({ enabled: false });
// …back to direct edits.

sobree.getTrackChanges();   // → { enabled: boolean; author?: string }
sobree.on("track-changes-change", state => /* … */);
```

The exact same API exists on the editor kernel —
`editor.setTrackChanges(…)`. The façade is a thin proxy; both
surfaces fire the same `track-changes-change` event, so listeners on
either see every flip.

**Authorship is optional.** `setTrackChanges({ enabled: true })` with
no `author` lands revisions with the field unset — Word's "anonymous
tracked change" semantics. The toolbar pill (in
`@sobree/block-tools`) preserves whatever author the embedder set;
the input next to it lets the user edit it.

## The three revision levels

Sobree distinguishes three kinds of tracked changes. Each has its own
storage in the AST, its own visual marker in the DOM, and its own
accept/reject method — but `getRevisions()` returns them in one
uniform list keyed by `level`.

| Level | AST field | DOM hint | Accept | Reject |
|---|---|---|---|---|
| `"inline"` | `RunProperties.revision` | `<ins>` / `<del>` element with `data-revision-author` | `editor.acceptRevision(range)` | `editor.rejectRevision(range)` |
| `"paragraph"` | `ParagraphProperties.revision` | `data-block-revision` on the `<p>` + CSS `::after` ¶ glyph | `editor.acceptParagraphRevision(blockRef)` | `editor.rejectParagraphRevision(blockRef)` |
| `"format"` | `RunProperties.revisionFormat = { before, author? }` | `<span class="sobree-revision-format">` with `data-revision-format-author` | `editor.acceptFormatRevision(range)` | `editor.rejectFormatRevision(range)` |

`editor.getRevisions()` walks the document and returns a
`RevisionSpan[]` covering all three. Each span carries `level`,
`author?`, `kinds`, `date?`, and a `range` you can hand back to the
right accept/reject method.

```ts
for (const span of editor.getRevisions()) {
  if (span.level === "paragraph") {
    editor.acceptParagraphRevision(span.range.from.block);
  } else if (span.level === "format") {
    editor.acceptFormatRevision(span.range);
  } else {
    editor.acceptRevision(span.range);
  }
}
```

Or in one call:

```ts
editor.acceptAllRevisions();              // sweeps all three levels
editor.acceptAllRevisions({ author: "Alice" });   // filter
editor.rejectAllRevisions();
```

### Inline (insertions and deletions of text)

The classic case — typed characters, pasted text, ranges deleted in
tracked mode. Each affected `TextRun` carries:

```ts
properties.revision = { type: "ins" | "del", author?, date? };
```

`acceptRevision(range)` over a span: insertions strip the marker and
keep the text; deletions drop the run. `rejectRevision(range)` does
the inverse. Adjacent same-author del+ins by the same author
coalesces into one logical "replacement" span — accepting or
rejecting it acts on both halves atomically.

### Paragraph mark (tracked Enter / Backspace at paragraph boundaries)

When the user presses Enter in tracked mode, the new paragraph
carries `ParagraphProperties.revision = { type: "ins", author }` —
semantically meaning "the paragraph break that precedes this
paragraph is a tracked insert." Backspace at the start of a
paragraph flags the same field with `type: "del"`, merging this
paragraph into the previous one on accept.

Accepting an `ins` paragraph mark just strips it. Accepting a
`del` mark **merges** the paragraph into the previous one.
`editor.acceptParagraphRevision(blockRef)` and the matching
`reject…` handle both polarities.

### Format change (`<w:rPrChange>`)

When the user changes formatting on a run in tracked mode,
`applyRunProperties` snapshots the original properties:

```ts
properties.revisionFormat = {
  before: RunProperties,   // pre-tracking snapshot
  author?: string,
  date?: string,
};
```

Repeated tracked format edits don't overwrite `before` — the
**original** state always wins on reject. Accepting drops the
snapshot; the current `properties` stay. Rejecting reverts
`properties` to `before` and drops the snapshot.

## How keystrokes become revisions

When `trackChanges.enabled` is on, the editor intercepts these input
paths and routes them through the typed API so the resulting runs
land with the right markers:

| Input | Routed to | Marker |
|---|---|---|
| `insertText` / `insertReplacementText` | `insertRun` | `revision: ins` on the run |
| `insertParagraph` | `splitBlock` | `revision: ins` on the new paragraph's properties |
| `insertLineBreak` (Shift+Enter) | `insertRun(BreakRun)` | `revision: ins` on the break run's properties |
| `deleteContentBackward` / `Forward` / `deleteWord…` / `deleteByCut` | `deleteRange` | `revision: del` on each text run in range |
| Paste (`text/plain`) | `onPaste` → `insertRun` + `splitBlock` per `\n` | each line ins, each break ins |
| IME composition | `compositionstart`/`compositionend` snapshot-restore | final composed string lands via `insertRun` |
| `applyRunProperties` | direct (no input event) | snapshot to `revisionFormat.before`, then apply patch |

The "own pending insert" cancellation: if a user types a sentence in
tracked mode (creating an `ins` span attributed to themselves) and
then deletes it before committing, the run is dropped outright with
no `del` trace — matching the intuition that an un-committed insert
isn't really an edit yet.

## How the API authors revisions

Every `editor` mutation honours `trackChanges.enabled` automatically:

```ts
editor.setTrackChanges({ enabled: true, author: "alice@…" });
editor.insertRun(at, run);                  // run gets revision: ins
editor.deleteRange(range);                  // runs in range get revision: del
editor.splitBlock(at);                      // new paragraph mark gets revision: ins
editor.insertBlockAfter(target, block);     // (paragraph) new block gets revision: ins
editor.deleteBlock(target);                 // (paragraph) block gets revision: del (text stays visible)
editor.applyRunProperties(range, patch);    // runs get revisionFormat snapshot
```

A caller-supplied revision wins — if you hand `insertRun` a run that
already carries a `revision`, Sobree doesn't overwrite it (useful
for replaying revisions from an external system).

## DOCX round-trip

All three revision levels survive `.docx` save→reopen, in both
directions, against Word / LibreOffice / Google Docs. The wire-format
mappings:

| Level | OOXML element | ECMA-376 ref |
|---|---|---|
| Inline `ins` | `<w:ins w:id w:author w:date>` wrapping `<w:r>` | §17.13.5.20 |
| Inline `del` | `<w:del …>` wrapping `<w:r>`; text in `<w:delText>` not `<w:t>` | §17.13.5.14 + §17.4.13 |
| Paragraph mark `ins`/`del` | `<w:pPr><w:rPr><w:ins .../></w:rPr></w:pPr>` | §17.13.5.7 |
| Format change | `<w:rPr><w:rPrChange w:id w:author w:date><w:rPr>…snapshot…</w:rPr></w:rPrChange></w:rPr>` | §17.13.5.32 |

## The review plugin

`@sobree/core` ships **neutral** semantic markers — underlines for
ins, strikethroughs for del, dashed underline for format change, a
trailing ¶ glyph for paragraph marks. This is fidelity: a `.docx`
with tracked changes always renders visibly, even with no plugin
mounted, so accepting a doc you imported never silently strips
revisions.

The `@sobree/review` plugin layers the **author colour and
interactive UI** on top: per-author tinting of every marker, a
hover popover with accept/reject buttons that work at all three
levels, plus the post-it comment cards in the right margin (the
comment-side of the review feature).

```ts
import { createSobree } from "@sobree/core";
import { review } from "@sobree/review";
import { blockTools } from "@sobree/block-tools";   // for the toolbar pill

createSobree(host, {
  content,
  plugins: [review(), blockTools()],
});
```

See [the review plugin API page](/api/review/) for the full surface.

## Headless / API-only flow

Track-changes works without any UI — useful for LLM agents,
JSON-RPC servers, automated review pipelines. The mode flag and the
mutation API are framework-free:

```ts
import { HeadlessSobree } from "@sobree/core";

const peer = new HeadlessSobree({ initialDocument: doc });
peer.editor.setTrackChanges({ enabled: true, author: "ai-reviewer" });
peer.editor.applyRunProperties(suggestedBoldRange, { bold: true });
peer.editor.insertRun(suggestedInsertPos, { kind: "text", text: " …", properties: {} });
// Result: a doc with both tracked changes, ready to surface in a
// human reviewer's editor via the standard review UI.
```

## Known limits

These are documented gaps that don't break the feature but a careful
reviewer might hit.

### Real gaps (a user could notice)

- **Per-cell single-accept** for revisions inside table cells. Bulk
  `acceptAllRevisions` works (it walks cells), but hovering an ins/del
  inside a cell and clicking the popover's ✓ doesn't dispatch —
  cell paragraphs aren't in the `BlockRegistry`, so `resolveSpan` can't
  find them. Extending the registry to cell paragraphs is the right
  fix; in the meantime, use bulk accept-all.
- **`applyBlockProperties` doesn't honour tracked mode.** Changing
  paragraph alignment / indent / styleId in tracked mode silently
  applies as a direct edit. Word records this as a paragraph-property
  revision (`<w:pPrChange>`); we'd model it as
  `ParagraphProperties.revisionFormat` parallel to the run-level field.
- **Image-file paste / drag-drop in tracked mode** doesn't stamp the
  drawing as a revision. The `stampInsertRevision` helper is text-only
  (mirrors `decideRevisionRun`); extending to non-text runs is small.
- **Rich HTML paste** in tracked mode falls back to `text/plain` by
  design — the marker contract is easier to keep tight that way.
- **Cell paragraph-mark del** falls back to strip-the-marker rather
  than merging cell paragraphs across boundaries; cross-cell merge
  is a structural edit kept separate.

### Documented trade-offs

- **Cross-paragraph `deleteRange`** in non-tracked mode collapses
  paragraphs into the first block (tracked mode marks them). This
  matches Word's behaviour.
- **Mode-toggle mid-composition** uses the commit-time mode, not the
  start-time mode — the user's most-recent toggle wins.
- **Date stamps** on revisions aren't auto-applied — imported docx
  revisions carry their original dates, but live-authored revisions
  don't get a current date. Easy to add.
- **`getRevisions`** doesn't walk into **nested tables** or
  **headers/footers** — tracked changes there are invisible in the
  dock but render in place. Rare in practice.

### Quality-of-life polish

These are nice-to-haves, not gaps:

- **Keyboard shortcuts** for accept/reject at caret (Cmd+Alt+A /
  Cmd+Alt+R — Word standard)
- **"Show markup" toggle** — Word's "Final" vs "All Markup" view
- **"Accept and advance"** combo for sequential reviewer workflow
- **Confirmation guard** on Reject-All (destructive bulk action)
- **Author colour picker** — today colour is FNV-hashed; tokens can be
  overridden at CSS level but no per-author UI
- **Author identity persistence** — toolbar input resets on page
  reload (could `localStorage`)

### Quality / testing debt

- Y.Doc collaboration with tracked revisions is theoretically correct
  (markers are plain AST fields) but not explicitly tested with two
  peers.
- HeadlessSobree should support the same authoring API as the live
  Editor; not specifically verified for revisions.
- The widened wrapper-detector (block-contains-revision) has browser
  integration coverage but no focused unit test.
