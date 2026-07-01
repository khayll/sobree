---
"@sobree/core": patch
---

Unify the two `<w:rPr>` (run-properties) importers into one reader.
`<w:rPr>` is a single OOXML concept with two homes — inside a `<w:r>`
(direct run formatting) and inside a `<w:style>` (a style's run defaults) —
but the importer parsed each with its own function, and the two drifted.
They now share one `readRunProperties(rPr)` that returns the native
`RunProperties` directly (dropping the redundant `RunFormat` intermediate
type and its mapping layer). Two latent bugs the drift had caused are fixed
as a result: a DIRECT run's underline now keeps its full style
(double / dotted / dashed / wave) instead of collapsing to single, and a
direct `<w:color w:val="auto"/>` that resets an inherited colour back to
automatic is now honoured (previously dropped, so the run stayed coloured).
