# @sobree/core

## 0.1.12

### Patch Changes

- 90a257b: More DOCX paragraph-import fidelity fixes:
  - **`Title`-styled paragraphs** keep their own style instead of being
    re-styled as `Heading1` — so a document title renders in its authored
    display font/size, not the heading font.
  - **`<w:numId w:val="0">`** is honoured as OOXML's "no numbering"
    sentinel (it cancels a list inherited from the paragraph style), rather
    than rendered as a stray ordered-list marker that over-printed the text
    and forced a phantom indent.

## 0.1.11

### Patch Changes

- 926d1a8: Add an optional version badge. Pass `versionBadge: true` to
  `createSobree` (or `new Sobree`) — off by default — to float a small,
  greyed, non-interactive `@sobree/core v<x.y.z>` label at the
  bottom-centre of the screen. It's a debug aid for confirming which
  renderer build is actually live (e.g. past a stale CDN / browser cache
  after a deploy) and has no other behaviour.

  Also exports `VERSION`, the published `@sobree/core` version string,
  baked in from `package.json` at build time.

## 0.1.10

### Patch Changes

- d321700: Rendering-fidelity fixes for complex DOCX layouts:
  - **Unequal multi-column sections** (`<w:cols w:equalWidth="0">`) render
    with their per-column widths, and a section with no column break is
    balanced like Word (equal column heights) instead of packing the first
    column to the page bottom.
  - **Anchored shape groups** honour their child-coordinate origin
    (`<a:chOff>`), so grouped drawings (e.g. logos) no longer render
    shifted from where Word places them.
  - **Custom-geometry shapes** (`<a:custGeom>` — logos, wordmarks, bespoke
    cuts) render as SVG paths instead of a fallback rectangle.
  - **`lineRule="exact"` line spacing** is honoured.
  - A paragraph style with no `basedOn` inherits **DocDefaults** rather
    than `Normal`.
  - Pagination and column balancing **re-run once embedded web fonts
    finish loading**, so a cold reload no longer mis-measures and
    mis-places content.

  Also internal-only: the source tree is now Biome-clean and gated, and
  the `Editor` constructor was decomposed into focused modules. No public
  API changes.

## 0.1.9

### Patch Changes

- bbbaef4: Pagination: a tall table row whose height comes from a non-paragraph
  cell (e.g. a bulleted list) is now measured by its tallest cell, so it
  splits across the page boundary instead of overflowing the page. The
  row's pagination boxes are made to sum to the row's true rendered
  height, so the paginator can never under-measure a row and run it past
  the bottom margin.

## 0.1.8

### Patch Changes

- 2ea12e8: Deliberate public API surface. 28 leaked internals are no longer
  exported (the granular Y.Doc schema keys and Run↔Delta conversion,
  parts-GC, pageSetup-bridge and zone-template internals) — the blessed
  Y.Doc wire contract is `seedYDoc` / `projectYDoc` /
  `applyDocumentToYDoc`. Breaking only for imports of those internals;
  no published consumer used them. Everything kept is now documented:
  new API pages for presence, zone editing, page setup, and the Y.Doc
  wire API, plus expanded editor/table/marks/events/options docs across
  the existing pages. A docs-coverage gate now enforces that new public
  exports ship documented.

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
