---
"@sobree/core": patch
---

Render a footnote's custom reference mark. Word lets a footnote use a custom
mark instead of the auto-number via `<w:footnoteReference w:customMarkFollows="1">`
followed by the mark text (e.g. an author "*" footnote). Sobree dropped that
trailing text and rendered the auto-number "1" at both the reference and the
footnote body ("1. * Place…"). The importer now captures the custom mark onto
`FootnoteRefRun.customMark`; the reference renders the mark, and the footnote
body — whose text already carries the mark — drops its `<ol>` counter so it
isn't doubled. `customMark` round-trips through the Y.Doc by construction.
