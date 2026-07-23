---
title: DOCX I/O
description: importDocx and exportDocx — round-trip a SobreeDocument through OOXML bytes.
---

Pure functions on bytes. Run them in the browser, in a Web Worker, or
anywhere else the AST is enough — the document model is JSON-clean and
no DOM is touched.

:::tip
For most embedders, the [`createSobree()`](/api/create-sobree/) handle's
`editor.toDocx()` and `editor.loadDocx(...)` shortcuts are simpler:

```ts
const { blob, warnings } = editor.toDocx();
const { warnings } = await editor.loadDocx(file);
```

Use the raw functions below when you don't have a mounted editor —
headless pipelines, Workers, server-side conversion, batch jobs.
:::

## `importDocx`

```ts
import { importDocx } from "@sobree/core";

const { document: doc, warnings } = await importDocx(src);
```

Accepts:

- `File` — straight from `<input type="file">`.
- `Blob` — from `fetch().then(r => r.blob())`.
- `ArrayBuffer` — from `fetch().then(r => r.arrayBuffer())` or
  `file.arrayBuffer()`.
- `Uint8Array` — from a Worker, server, or in-memory cache.

Returns a `SobreeDocument` plus a list of conversion warnings. Warnings
fire for OOXML constructs the importer doesn't yet understand — they
don't block the import; the unhandled bits are dropped and noted.

Multi-section documents arrive with one `SectionBreak` block per
non-final section; `document.sections` has one entry per section in
order.

## `exportDocx`

```ts
import { exportDocx } from "@sobree/core";

const { blob, bytes, warnings } = exportDocx(doc);
```

Synchronous. Returns:

- `blob: Blob` — drop into `URL.createObjectURL` for download.
- `bytes: Uint8Array` — for upload, hash, or further processing.
- `warnings: string[]` — typically empty; populated when the AST contains
  shapes the exporter can't fully represent.

Multi-section documents emit one `<w:sectPr>` per section. Non-final
sections' sectPr is spliced into the last paragraph of their range
(OOXML's "section ends here" convention; ECMA-376 §17.6.18). The
final section's sectPr lands at body level.

## Round-trip stability

Export regenerates the OOXML package from the AST (it does not splice
original XML), so the guarantee is **semantic, not byte-level**: an
open → save cycle is a tested fixpoint —
`import(export(import(docx)))` equals `import(docx)` for every corpus
document (`feature.exportFixpoint.test.ts`). Binary parts (images,
fonts) are copied byte-for-byte. Focused round-trip suites additionally
lock paper sizes, margins, headers / footers, vAlign, title-page
sections, tables, images, page numbering fields, numbering definitions,
and multi-section documents.

Footnotes and comments round-trip: export emits `word/footnotes.xml`,
`word/comments.xml` and (for resolved / threaded comments)
`word/commentsExtended.xml`, with reference marks and comment ranges
reconstructed in the body. Custom footnote marks
(`customMarkFollows`) and comment threading (`done`, reply-to)
survive a save → open.

Anchored floating drawings round-trip: pictures, text boxes, shapes
(presets and custom geometry), and drawing GROUPS — including nested
groups and their child coordinate systems — serialize back to
`<wp:anchor>` DrawingML with their positioning (EMU offset / alignment
/ percent forms), percent sizes, wrap mode, text distances and
behind-text state intact. Header/footer floating drawings re-anchor in
their parts; float-placed images keep their wrap side and clearance
margins; inline drawing groups (`InlineFrame` blocks — pill headings,
project entries, picture bands) re-emit as `<wp:inline>` groups or, for
picture bands, as the anchored pictures they were synthesized from.

Content controls (Structured Document Tags) pass through: block-level
`<w:sdt>` wrappers — repeating sections, dropdowns, placeholders,
tagged template fields — round-trip with their `<w:sdtPr>` preserved
verbatim, re-grouped around their content on save. Editing inside a
control splits it rather than corrupting it.

Known exporter gaps (documented in the fixpoint test): inline drawing
groups holding neither a textbox nor a picture (pure decorative shape
groups); even-page header/footer parts (a pre-existing scope cut —
proper support needs `w:evenAndOddHeaders` settings plumbing); and
cell-level / run-level content controls, which still flatten to their
content.

## Headless usage

DOCX I/O has no DOM dependency; you can run it server-side or in a
Worker:

```ts
// Worker:
self.addEventListener("message", async ({ data: bytes }) => {
  const { document: doc } = await importDocx(bytes);
  self.postMessage(doc);   // JSON-clean — structuredClone-friendly
});
```
