---
"@sobree/core": minor
---

Per-part CRDT for composite content (tables + floating textbox frames). Both
used to ride in the Y.Doc as one opaque JSON blob — a table as a single `_ast`
string, the floating layer as a `meta.anchoredFrames` JSON string — so any
concurrent edit clobbered the whole table / whole frame layer (last-writer-wins).

Now:

- **Tables** store cell content as nested Y structure (`rows`/`cells`/`content`
  Y.Arrays, per-cell JSON props, cell paragraphs backed by `Y.Text`).
- **Anchored frames** (textbox "pills", brochure panels, grouped drawings) each
  become their own Y.Map in dedicated `anchoredFrames` / `headerFooterFrames`
  roots, with textbox bodies reusing the same nested content codec.

Result: concurrent edits to **different cells**, or to **different frames**,
merge instead of clobbering; text inside a cell or frame merges char-level like
body paragraphs. The block↔Y.Map mapping is a single recursive codec used at
the top level and at any nesting depth. Legacy documents (whole-table `_ast`,
`meta`-blob frames) project via a fallback and migrate to the nested shape on
first edit — no data loss, verified by corpus-wide round-trip parity.
