---
"@sobree/core": patch
---

Word-fidelity and losslessness release:

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
