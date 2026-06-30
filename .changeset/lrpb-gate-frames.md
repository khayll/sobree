---
"@sobree/core": patch
---

Stop over-paginating plain text-flow documents. Sobree honoured Word's
`<w:lastRenderedPageBreak/>` hints as forced page breaks whenever a doc had
≥10 of them — a band-aid for frame-heavy layouts (complex-multipage's 32
inline-frame pills) whose heights the paginator estimates imperfectly. But for
a plain-flow document those stale hints, which mark where Word *last* broke,
don't line up with Sobree's own (accurate) pagination and strand half-empty
pages: the ACM submission template blew up from 13 pages to 17. Honouring the
hints is now gated on the document actually having inline-frame groups, so
plain-flow docs re-paginate fresh per ECMA-376. ACM drops 17 → 13 (matching
Word); other hint-heavy reports improve too (wsu-thesis 38 → 32,
fedramp 47 → 37); frame-heavy docs (complex-multipage) are unchanged.
