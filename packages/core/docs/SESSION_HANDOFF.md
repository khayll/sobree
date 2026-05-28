# Paginator — architectural note

A short, durable note on the paginator's design constraints. Earlier
revisions of this file were a session-specific status snapshot tied to
one corpus fixture; the takeaways below are the parts worth keeping.

## Constraint: the engine must be able to grow the page array

The pagination engine should be a pure function
`(measurements, constraints) → pages[]` where forced-break boundaries
are first-class outputs, not post-processed in. Once a forced break is
honored, the page array must be allowed to grow when preceding content
no longer fits — otherwise breaks silently shorten the document and
overflow shows up as content past the page bottom instead of a new page.

Empirically, the wrong shape is: Knuth-Plass produces N pages → a
post-process collapses widows → forced breaks that would have spawned
page N+1 are lost. Adding hand-tuned absorption passes papers over
symptoms and creates regressions elsewhere.

## Rule 0 — first principles only

Before reaching for a hand-tuned constant or a post-process pass, pause
and check whether you're addressing the cause or the symptom. Per-page
spacing nudges don't compound to architectural shortfalls. If the
delta is more than line jitter, it isn't a spacing problem.

## Measurement before motion

Convergence vs the LibreOffice reference is the source of truth for
"is this rendering right?" — not eyeballed screenshots. Run
`window.convergenceReport()` from the playground console and read the
per-page numbers (medDy, matched, page count) before changing anything.

## When `<w:lastRenderedPageBreak/>` matters

The OOXML spec says consumers SHOULD ignore `<w:lastRenderedPageBreak/>`
for layout — it's a record of where Word's engine broke pages last
save. Strictly ignoring it on heavily-decorated documents fragments
the page layout vs Word/LO's intent. The importer takes a middle
ground: honor the hint when many (≥10) are present (a strong signal
the source was actively paginated by Word) and ignore it otherwise.
That threshold lives in `docx/import/document.ts`.
