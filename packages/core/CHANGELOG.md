# @sobree/core

## 0.1.7

### Patch Changes

- 072d31a: Crisp text at any zoom: the viewport now uses two-phase rendering.
  While a gesture is live the stage stays on a composited layer (fast but
  soft); 180ms after input settles the compositor re-rasterises at the
  effective scale, so text at high zoom is as sharp as a natively-sized
  layout. Gesture handling is also split into dedicated wheel/touch
  controllers with unit tests.

## 0.1.6

### Patch Changes

- 35f46ff: Mobile touch support in the embed viewport: one-finger drag pans (with
  a tap slop so caret placement still works), two-finger pinch zooms
  anchored at the finger midpoint. Previously `touch-action: none` left
  touch devices unable to scroll or zoom at all.

## 0.1.5

### Patch Changes

- 985e472: Zoom never changes layout: the viewport's layout-side zoom tiers are
  retired — zooming is now a pure `transform: scale`. Previously the page
  re-laid-out at quantised CSS `zoom` tiers, and because browsers scale
  font metrics and the page's mm-derived width through different rounding
  paths, text rewrapped and pagination shifted at tier flips. Line and
  page breaks are now identical at every zoom level. The tier API
  (`onRenderTierChange`, `getRenderTier`) remains for compatibility and
  always reports tier 1.

## 0.1.4

### Patch Changes

- 7bddb71: Rendering and pagination fidelity:
  - Behind-text anchored frames (`behindDoc="1"` — page-background shapes,
    watermarks) paint in a dedicated layer below the body text; previously
    they painted on top of it (visible once theme-colour fills resolved,
    blanking entire pages).
  - Multi-level lists render each item at its own level: indent, marker
    glyph, marker box width, and marker formatting per `ilvl` (was: every
    item flattened to one level).
  - The paginator counts real inter-item spacing in lists; spaced bullet
    lists no longer over-pack pages and run content through the bottom
    margin.
  - Bare inline `<wps:wsp>` shapes (coloured rectangles with no group or
    textbox) render as inline frames — including inside table cells.
  - Runs inside run-level `<w:sdt>` content controls import (previously
    dropped); Wingdings 3 `0xF07D` maps to a right-pointing triangle.

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
