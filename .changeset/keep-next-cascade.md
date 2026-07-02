---
"@sobree/core": patch
---

Honour `<w:keepNext/>` and `<w:keepLines/>` from the style cascade and
direct paragraph formatting. Word's heading styles declare both (ACM's
`Head2` inherits them from the built-in `Heading2` via `basedOn`), but the
style importer never read them, so the paginator happily stranded headings
at the bottom of a page — a break Word never produces. The flags (plus
`<w:pageBreakBefore/>`, previously lost on DIRECT paragraphs) are now read
tri-state at both homes — style pPr and direct pPr — so an explicit
`w:val="0"` overrides an inherited flag, and they round-trip through
export. A paragraph's `keepLines` maps to per-line keep-together boxes in
the paginator, keeping its `keepNext` and widow/orphan metadata intact
(collapsing it to a monolithic group box would have discarded them).
