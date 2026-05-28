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

For paragraphs the editor hasn't touched, export is byte-stable —
import → export produces the same `.docx` modulo Word's own canonical
formatting tweaks. Round-trip tests in `packages/core/src/docx/`
verify this for paper sizes, margins, headers / footers, vAlign,
title-page sections, tables, images, page numbering fields, and
multi-section documents.

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
