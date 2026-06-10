# @sobree/core

## 0.1.3

### Patch Changes

- 0d62712: Word-fidelity and losslessness release:
  - Text wraps around floating images (`wrapSquare`/`wrapTight`/`wrapThrough`
    → CSS floats with `distT/B/L/R` clearance), across paragraphs (one
    block formatting context per page body).
  - Bullet lists no longer import as numbered (`numStyleLink` resolution);
    faithful hanging-marker geometry (marker at `left − hanging`, text at
    `left`); markers render their own colour / font / size.
  - Heading style ids canonicalise so heading colour/caps resolve; run
    character styles (`<w:rStyle>`) apply; paragraph borders read from
    styles; DrawingML theme colours (`<a:schemeClr>` + transforms) resolve.
  - Font FACE names ("Helvetica Neue Light") resolve to family + weight;
    HYPERLINK fields render as styled hyperlinks; header/footer body
    clearance matches Word's reservation rule.
  - Losslessness hardening: the Y.Doc transport carries runs structurally
    (no field whitelist; footnote/comment refs and float/anchor drawing
    fields now survive reloads), locked by a corpus-wide parity invariant;
    export emits `word/numbering.xml` (lists survive open → save), locked
    by a corpus-wide export-fixpoint invariant.

## 0.1.2

### Patch Changes

- 38cfb11: Fix two DOCX import/render bugs surfaced by real-world CVs:
  - Paragraph styles whose id contains a space (e.g. `"Contact Information"`)
    no longer crash the renderer. The style id is carried in a
    `data-style-id` attribute instead of a CSS class, which also makes the
    style round-trip lossless (the old class lowercased and mangled
    multi-word ids).
  - `<w:pageBreakBefore>` now honours its `w:val`. It is a `CT_OnOff`
    toggle, and Word writes the explicit-off form (`w:val="0"`) in
    DocDefaults / styles; reading it by presence alone added a page break
    before every paragraph (a 2-page CV rendered as 32).

## 0.1.1

### Patch Changes

- Ship dist-only `exports` via `publishConfig.exports`. The `development`
  condition (→ `src`, used for workspace HMR/typecheck) was shipping in
  the published package, where `src` is absent — breaking consumers'
  `vite dev` ("Failed to resolve entry"). The published `exports` is now
  clean dist-only; the source/workspace resolution is unchanged.
