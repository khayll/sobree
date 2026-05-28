---
title: Fonts (font table + embedding)
description: word/fontTable.xml round-trip, ODTTF codec, OS/2 fsType licence check, runtime @font-face registration.
---

The fonts module lives at `packages/core/src/fonts/` and owns
everything font-related: the AST shape (`FontDeclaration`), the OOXML
import + export of `word/fontTable.xml`, the ODTTF obfuscation codec,
the OS/2 `fsType` licence reader, and the runtime `@font-face`
registration that lets embedded faces actually render.

## Public API on the Editor

```ts
editor.embedFont(name: string, faces: EmbedFontFaces, opts?: EmbedFontOptions): { warnings: string[] };
editor.removeEmbeddedFont(name: string): void;
```

`createSobree()` exposes these via its `editor.editor.embedFont(...)`
escape hatch.

```ts
const result = editor.editor.embedFont("Inter", {
  regular: interRegularBytes,    // Uint8Array — TTF or OTF
  bold: interBoldBytes,
  italic: interItalicBytes,
  boldItalic: interBoldItalicBytes,
});
if (result.warnings.length) console.warn(result.warnings);
```

The bytes get ODTTF-obfuscated and stored under
`rawParts['word/fonts/fontN.odttf']`. A matching `<w:font>` declaration
lands in `doc.fonts` so Word (and our own renderer) can resolve the
face by name. The renderer auto-registers `@font-face` rules for every
embedded face — the `font-family: Inter` you've been writing in the
toolbar now actually displays Inter, not the OS fallback.

## OS/2 fsType licence check

Every face is checked against the OS/2 `fsType` field before embedding:

| `fsType` mode      | Default behaviour                     |
| ------------------ | ------------------------------------- |
| `installable`      | Embed (no warning)                    |
| `editable`         | Embed (no warning)                    |
| `preview`          | Embed (no warning) — preview/print only |
| `restricted`       | **Refuse**, push warning              |

Override with `{ allowRestricted: true }` if you have separate licence
clearance:

```ts
editor.editor.embedFont("Restricted-Face", { regular: bytes }, {
  allowRestricted: true,
});
```

## Round-trip

`importDocx()` parses `word/fontTable.xml` into `doc.fonts`, preserves
the `.odttf` bytes verbatim in `rawParts` (no deobfuscation —
re-export is byte-faithful when nothing changed). `exportDocx()` emits
`word/fontTable.xml`, the companion `.rels`, the `Default Extension="odttf"`
content-type entry, and the document-level `fontTable` relationship.

```ts
import { importDocx, exportDocx } from "@sobree/core";

const { document } = await importDocx(fileBytes);
console.log(document.fonts);
// → [{ name: "Calibri", panose: "020F0502...", embed: { regular: { partPath: "word/fonts/font1.odttf", fontKey: "{...}" } } }]

const { blob } = exportDocx(document);
// blob now contains word/fontTable.xml + word/fonts/font1.odttf identical to the input
```

## Headless API

For pipelines that don't have an Editor (Workers, batch tools), the
module exports pure helpers:

```ts
import {
  embedFontIntoDoc,
  removeFontFromDoc,
  obfuscate,
  deobfuscate,
  generateFontKey,
  readFsType,
  canEmbed,
} from "@sobree/core";
```

`embedFontIntoDoc(doc, name, faces, opts?)` returns
`{ next: SobreeDocument; warnings: string[] }`. `next` is the same
reference as the input doc when nothing was embedded, otherwise a
fresh doc with the new declaration + obfuscated bytes.

## Renderer-side `@font-face`

The Editor owns a `FontFaceRegistry` that:

- Mints a single `<style data-sobree-font-faces>` element in
  `document.head`.
- For every `FontDeclaration.embed` ref, deobfuscates the `.odttf`
  bytes, wraps them in a `Blob`, mints an object URL, and writes a
  `@font-face { font-family: <name>; src: url(blob:...); ... }` rule.
- Re-syncs on every `setDocument()` (undo / redo / load).
- Revokes blob URLs on editor destroy.

Without this, the renderer's `font-family: Inter` style would silently
fall back to the OS — defeating the embed.

## Limitations

- **No glyph subsetting.** Full faces are written; inheriting a doc
  with embedded Helvetica means the whole Helvetica face ships. (The
  AST's `subsetted: true` flag is preserved on round-trip, so a doc
  imported with subsetted fonts re-exports as subsetted.)
- **No theme fonts.** `<w:rFonts w:asciiTheme="majorHAnsi"/>` isn't
  resolved yet — only literal `font-family` names work.
- **No `<w:embedSystemFonts/>` flag.** Always-on system fonts (Arial,
  Times New Roman) skip embedding by Word convention; not enforced
  here yet.

## Reference counting

`editor.pruneUnusedParts()` drops `rawParts` entries that no
`DrawingRun.partPath` or font embed references. `removeEmbeddedFont`
doesn't auto-prune; either call `pruneUnusedParts()` or rely on
`exportDocx()`'s built-in liveness filter (it only ships referenced
parts).

## Related

- [`createSobree()`](/api/create-sobree/) — `editor.embedFont()` example
- [DOCX I/O](/api/docx/) — `importDocx` / `exportDocx`
- [Document model](/concepts/document/)
