# Sobree-vs-LibreOffice convergence — the working process

This is the **rules of engagement** for closing the gap between
Sobree's render of a fixture and LibreOffice's reference render.
The CONVERGENCE methodology is non-negotiable; deviating from it
produced hours of whack-a-mole iteration on `complex-multipage`
where each visual fix surfaced a new issue elsewhere.

## Rule 0 — Don't think in "fixes". Think in first principles.

The word **fix** triggers reflexive symptom-chasing: spot the visible
problem, edit the nearest CSS / value / branch that affects it, move
on. That produced 150+ tasks closed and the underlying architecture
still tangled — every fix layered on the previous, the code grew
1000+ lines of accreted heuristics, and the bugs kept reappearing in
different shapes.

The replacement instinct: **solve the problem from first principles
into a design that is modular, composable, easy to maintain, and easy
to extend.** When you spot a visible problem:

  1. Identify the SHAPE of the problem (what kind of feature is it
     fundamentally — list spacing? floating object? page break?).
  2. Find the smallest set of OOXML / DrawingML concepts that
     produce this kind of problem.
  3. Locate (or design) the module that should OWN that concept.
  4. Make the change inside that module's contract. If the contract
     doesn't accommodate the change, the contract is wrong — change
     it, and update every caller.
  5. If you find yourself adding a special case at a call site or
     a magic number anywhere, STOP. The model is wrong; redesign.

This is slower than "fix". It is the only thing that produces code
that doesn't decay into more bugs.

## Hard rules

1. **No hacking.** Don't fix symptoms with hand-tuned magic
   numbers, ad-hoc padding adjustments, post-pagination
   absorption passes, or per-fixture conditionals. Every fix
   must be grounded in OOXML / DrawingML / numbering semantics
   — pull the source data through to the renderer, don't guess.
   When a value comes from the document (margin, indent,
   offset, fill), READ IT and convert it; never paste a
   millimetre constant.

2. **Always measure before AND after.** No fix lands without a
   delta number that confirms it improved things AND didn't
   regress something else. See "the loop" below.

3. **Fix root cause, not symptom.** If "Project: X" overlaps
   body text, the answer is rarely "add 5mm padding". It's
   usually "the textbox shape geometry isn't being passed
   through" or "the lifter is duplicating content". Find the
   pipeline stage that LOST the source-document information
   and add the data flow.

4. **Tests + corpus stay green at every step.** Each commit
   passes `pnpm test:core` and `pnpm corpus:check`. Visible
   visual regressions on previously-clean pages are also
   regressions — re-measure the whole document, not just the
   area you touched.

5. **Snapshot reviews drive ATTENTION, never DIAGNOSIS.**
   When the user points at a screenshot, that tells me WHERE
   to look. The diagnosis comes from reading the OOXML and
   the rendering pipeline.

## The two complementary signals

### 1. Layout delta (text positions)

`tools/fixtures-gen/src/corpus/layoutDelta.ts` compares per-line
positions: Sobree's rendered DOM lines vs LibreOffice's
`metrics.json`. Outputs: medDx, medDy, maxDy, P95 dy, top-N
worst lines.

This catches: vertical drift, horizontal shifts, missing lines,
wrapped-differently lines. Doesn't catch: decoration colour /
shape / outline issues.

### 2. Screenshot side-by-side (pixel diff)

LO reference PNGs live in `libreoffice/page-{1..N}.png`. We
render Sobree to PNG (headless, same DPI), compare per-region.

This catches: decoration shapes, fill colours, frame outlines,
icon positions, dot/atom artwork. Complements the text signal.

## The loop (one turn = one root-cause fix)

```
1.  MEASURE
    - run delta report → medDx, medDy, P95, worst-N lines
    - capture per-page screenshots
    - if user is looking at a specific area, also dump that
      region's source XML + AST + rendered HTML for inspection
    OUTPUT: a one-page diagnostic with "the 3 worst things"

2.  DIAGNOSE (root cause, not symptom)
    - pick the highest-impact item from worst-N
    - read the OOXML that produced it
    - trace the data through the pipeline:
        XML → importer → AST → renderer → DOM
    - find the stage that drops or distorts the source data
    OUTPUT: a one-line root-cause statement
            "the textbox-shape xfrm is read on anchored
             drawings but not on inline ones"

3.  FIX
    - one PR-sized change to the responsible stage
    - new types if needed, new readers if needed, new
      renderer pass if needed — but always pull the source
      data through, never paste a constant
    - if a change requires "magic numbers" to compensate
      for missing source data, the FIX is to add the source
      data, NOT to tune the numbers

4.  RE-MEASURE
    - delta report must improve on the worst-N entry
    - no other entry may get worse by > 5pt
    - tests + corpus stay green
    - if any of the above fails: revert, re-diagnose

5.  STOP CRITERIA per fixture page
    - medDy ≤ 10pt   (one line of slack)
    - P95 dy ≤ 30pt  (less than a section-frame height)
    - medDx ≤ 5pt    (about 2 character widths)
    - unmatched lines ≤ 5% of LO total
    - no visible regressions in screenshot side-by-side
```

## What "no hacking" specifically rules out

Concrete examples of hacking we've already burned hours on
and must NOT repeat:

- ❌ `absorbUnderfilledPapers` — pulled blocks across page
  boundaries post-pagination to hit a target page count.
- ❌ `tightenEmptyParagraphRuns` — mutated empty-paragraph
  line-heights to fit content into pages.
- ❌ `tightenDefaultAfterSpacing` — regex-matched `4mm`
  margins inside table cells and zeroed them.
- ❌ `padding: "0.5mm 18mm 0.5mm 18mm"` — hand-tuned per-frame
  padding because the textbox-shape geometry wasn't being read.
- ❌ banner / sidebar / band classifier by aspect ratio —
  guessed at what a picture meant based on its shape.
- ❌ CSS `margin-bottom === "4mm"` string-match overrides.

What every one of these had in common: **the source data
existed in the OOXML, but the importer wasn't reading it.**
The proper fix is always to extend the importer.

Acceptable mechanisms (NOT hacks):

- ✅ Reading an OOXML attribute and converting it to CSS.
- ✅ Computing a CSS percentage from `offsetX / groupCx`.
- ✅ Carrying a new geometry field through the AST.
- ✅ Adding an `AnchoredFrame.content` variant with its real
  semantic meaning.

## Per-region targeted iteration

When the user spots a misaligned element ("the heading text
is touching the dot"), the fast loop is:

1. Identify the BLOCK that produced it (data-block-index in
   the DOM, then look up in `editor.getDocument().body`).
2. Print the block's properties + the source XML for the
   corresponding `<w:p>` (and any wrapping `<w:drawing>`).
3. Identify the OOXML feature that says where it should go
   (typically `<w:ind>`, `<w:tabs>`, `<wps:spPr><a:xfrm>`,
   `<a:positionH/V>`).
4. Trace whether that feature was READ by the importer, then
   whether it was APPLIED by the renderer. The break is
   somewhere in that chain.
5. Fix the chain — usually adding a field to the AST and
   a property to the renderer's output.

Forbidden shortcut: looking at the rendered position, eyeballing
how far off it is, and adding that many mm of padding. That's
the loop we keep falling back into.

## Existing tooling

- `tests/corpus/real-world/cv/complex-multipage/libreoffice/metrics.json`
  — LO per-line positions for every page.
- `tests/corpus/real-world/cv/complex-multipage/libreoffice/page-N.png`
  — LO reference renders.
- `tools/fixtures-gen/src/corpus/layoutDelta.ts` — the delta
  calculator (currently page 1 only; extending to all pages
  is queued).
- `pnpm corpus:check` — coarse drift gate.

## Aspirational tooling (to be built incrementally)

- `pnpm convergence:report <slug>` — full multi-page delta
  report, prints worst-N lines with diagnostic context.
- Headless screenshot capture + pixel diff against LO PNGs.
- A "blame the OOXML" command that takes a `data-block-index`
  and dumps the corresponding source XML + AST node.

Build them as we need them. Don't pre-build speculative
infrastructure.
