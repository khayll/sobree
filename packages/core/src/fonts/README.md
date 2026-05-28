# `@sobree/core/fonts`

Self-contained font module for the Sobree editor. Every font-aware
piece of code lives here — types, OOXML import + export, ODTTF
obfuscation codec, OS/2 fsType licence check, AST mutators, and
runtime `@font-face` registration. Other modules in `@sobree/core`
should import from this directory's `index.ts`, never from the
individual files.

## Files

| File | Role |
| --- | --- |
| `index.ts` | Public surface for the module — single import point |
| `types.ts` | `FontDeclaration`, `FontEmbedRef` (re-exported via `doc/types`) |
| `odttf.ts` | XOR obfuscation codec per ECMA-376 Part 4 §2.8.1 |
| `fsType.ts` | OS/2 table reader → installable / preview / editable / restricted |
| `parse.ts` | `mountFontTableFromZip(textParts, parseRels)` |
| `emit.ts` | `mountFontTableArtifacts(doc, ctx)` |
| `embedAPI.ts` | `embedFontIntoDoc()`, `removeFontFromDoc()` (pure on `SobreeDocument`) |
| `liveness.ts` | `fontLivenessPaths(doc)` for the parts GC |
| `fontFaceRegistry.ts` | DOM `@font-face` registration with blob URLs |

## Integration points

The module is plugged into the rest of `@sobree/core` at exactly four
sites — the orchestration calls, never any reach-through into
internals.

- **`doc/types.ts`** re-exports `FontDeclaration` so existing
  consumers still resolve it from the AST module.
- **`doc/parts.ts`** calls `fontLivenessPaths(doc)` so the part GC
  knows which fonts to keep.
- **`docx/import/index.ts`** calls `mountFontTableFromZip()` once.
- **`docx/export/index.ts`** calls `mountFontTableArtifacts()` once.
- **`editor/index.ts`** calls `embedFontIntoDoc()` /
  `removeFontFromDoc()` from its `embedFont()` / `removeEmbeddedFont()`
  methods, and instantiates `FontFaceRegistry` once for the lifetime
  of the editor.

## Extension points

Adding a new face slot (e.g. `<w:embedItalicCondensed>`):

1. Add the key to `FontDeclaration["embed"]` in `types.ts`.
2. Add the slot to the `slots` arrays in `parse.ts`, `emit.ts`,
   `embedAPI.ts`, and `fontFaceRegistry.ts`. Each is a single tuple
   addition.

Adding a new ODTTF variant (e.g. raw TTF without obfuscation):

1. Update `embedAPI.ts:embedFontIntoDoc` to skip the `obfuscate()`
   call and clear `fontKey` on the resulting `FontEmbedRef`.
2. `fontFaceRegistry.ts` already handles missing keys via
   `isUnobfuscated()`; no change needed.

## Cross-module dependencies

The fonts module depends on:
- `doc/types` (for `SobreeDocument` shape).
- `docx/shared/{xml,namespaces}` (for OOXML parsing primitives).
- `docx/export/context` (for `ExportContext` shape — `mountFontTableArtifacts`'s sole side-effect target).

It does NOT depend on `editor/`, `paperStack/`, or `pagination/` — so
it's available to any consumer that has a `SobreeDocument` and
optionally a DOCX import/export context.
