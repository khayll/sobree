# @sobree/core

## 0.1.20

### Patch Changes

- c616398: Fix a table being hoisted to the front of the first page (its inline
  images appearing above the document title).

  Tables paginate per row: each `<tr>` becomes a box, and `distributePages`
  rebuilds per-page table clones. The iterative repagination loop can leave
  a table with multiple `<thead>` / `<tbody>` sections (a clone's section
  landing beside the source's). `tableRowBoxes` walked only the FIRST
  section of each kind (`querySelector`), so rows in the extra sections were
  never emitted as boxes — never paginated, never moved — and the source
  table husk that still held them lingered as an orphan, ending up at the
  front of the first paper. It now walks every section (`querySelectorAll`),
  so every row is distributed exactly once and no husk is left behind.

## 0.1.19

### Patch Changes

- f293f79: Render heading outline numbers ("1", "1.1", "1.2", "2") on headings whose
  paragraph style links a numbering definition (`<w:numPr>` on a heading
  style) — previously dropped, so numbered headings imported as plain text.
  - The style importer now reads a style's `<w:numPr>` into a new
    `NamedStyle.numbering` field.
  - A renderer pass walks the body in document order maintaining a counter
    per outline level (with per-level reset), formats each number from the
    numbering definition's `lvlText` + `numFmt` (decimal, roman, letter),
    and stamps it as a `data-outline-number` marker painted via `::before`
    — so the number stays out of the editable text and selection.

  Scoped to heading styles (the style's basedOn chain reaches a built-in
  `HeadingN`), so style-linked _lists_ are not mis-numbered.

- b4b5a1f: Stop a mid-paragraph `<w:lastRenderedPageBreak/>` hint from forcing the
  whole paragraph onto a new page.

  Word records a layout hint at the exact run position where a page broke
  last time. A hint at a paragraph's START is a real boundary, but a hint
  in the MIDDLE marks where that paragraph's own lines wrapped to the next
  page. The importer treated any hint in the paragraph as
  `pageBreakBefore`, so a paragraph that should fill the bottom of a page
  and continue overleaf was instead shoved entirely to the next page —
  leaving the previous page half-empty and inflating the page count. It now
  honours only a _leading_ hint; mid-paragraph hints are left to the line
  paginator, which already splits a paragraph across a page boundary.

- 2d7f19d: Fix header/footer `PAGE` / `NUMPAGES` fields that carry a formatting
  switch (`PAGE \* MERGEFORMAT`, `NUMPAGES \* Arabic`) rendering a stale
  cached value on every page instead of the live page number.

  The field-instruction matching was exact (`instruction === "PAGE"`), so
  Word's near-universal `\* MERGEFORMAT` switch made it miss and the cached
  number leaked through. Recognition now matches the field TYPE (the first
  token of the instruction) via a shared `fieldType()` helper, applied
  consistently across the three places that resolve page fields (the
  per-page zone substitution, the header/footer importer, and the
  page-setup bridge).

- 13498fe: Resolve two paragraph-style cascade gaps that made documents render
  unlike Word:
  - **Style-level first-line / hanging indent.** The style reader only
    honoured `<w:ind w:left>` / `w:right`, so a body style carrying a
    first-line indent (a very common pattern) was dropped and its
    paragraphs rendered flush. It now reads `w:firstLine` / `w:hanging`
    (and the `w:start` / `w:end` aliases) too.
  - **`color="auto"` overrides.** A style that set `color="auto"` had it
    silently dropped, so a heading style based on the built-in blue
    `Heading1` inherited the blue instead of resetting to automatic
    (black). `auto` is now kept and rendered as `currentColor`, so it
    correctly overrides an inherited colour.

## 0.1.18

### Patch Changes

- a3b107a: Multi-column sections now **snake across pages**. Previously a section with
  `<w:cols>` was laid out as one monolithic, single-page block — equal-width
  columns relied on CSS `column-count`, which cannot fragment across the
  editor's fixed-height page boxes, so anything taller than one page was
  clipped. A multi-page two-column document rendered as a single overflowing
  page.

  `flowColumnSections` (formerly the unequal-only `flowUnequalColumnSections`)
  now owns the whole 2-D layout for **both** equal- and unequal-width
  sections: it flows content in newspaper order — fill column 0 to the page
  bottom, then column 1, then continue on the next page — emitting one
  page-sized column wrapper per page. The paginator stays column-agnostic and
  simply places each wrapper, so columns snake from page to page. Interior
  pages are filled; the final page is balanced (Word's "balance columns at
  section end"), which keeps single-page sections byte-identical to before.

## 0.1.17

### Patch Changes

- 16a2f20: Render (and, where needed, import) several formatting properties that were
  previously dropped, so documents that use them — and the builder/edit-op
  API that can set them — now display correctly:
  - **First-line / hanging paragraph indent** (`<w:ind w:firstLine>` /
    `w:hanging`) → CSS `text-indent` — common in prose.
  - **Small caps** (`<w:smallCaps>`) → `font-variant-caps: small-caps`.
  - **Double strikethrough** (`<w:dstrike>`) → double line-through.
  - **Run-level shading** (`<w:shd w:fill>` on a run) → background fill.
  - **Hidden text** (`<w:vanish/>`) — hidden by default (print-faithful);
    `showHiddenText` constructor option + `setShowHiddenText(show)` runtime
    toggle reveals it (dotted underline) for editing.
  - **Table width + alignment** (`<w:tblW w:type="dxa">` → `widthTwips`,
    `<w:jc>` → `alignment`) — now imported and rendered (table width + auto-
    margin centring / right-align).

  Verified against the LibreOffice corpus oracle — all entries within
  baseline tolerance (fidelity improvements, not regressions).

## 0.1.16

### Patch Changes

- 3af7242: Add numbering / list-definition support: builders
  (`numberingDefinition`, `numberingLevel`, plus `bulletDefinition` /
  `orderedDefinition` convenience helpers) and the `editor.numbering` edit
  operation (`define` / `update` / `remove`) for the `NumberingDefinition`s
  in `SobreeDocument.numbering`.

  Pointing a paragraph at a list is already `applyBlockProperties(refs, {
numbering: { numId, level } })`; this manages the list-format definitions
  those ids resolve to. Mirrored on HeadlessSobree (`defineNumbering` /
  `updateNumbering` / `removeNumbering`) with Y.Doc parity.

- 2fd2233: Add `editor.sections.setProperties(index, patch)` — a targeted,
  undo-integrated edit operation for a section's page geometry (size,
  margins), columns, header/footer references, and vertical alignment.
  Previously these could only be changed by replacing the whole document.

  Section ops are grouped under a new `editor.sections` sub-object
  (mirroring `editor.table`) so the Editor facade stays thin as the edit-op
  surface grows. `pageSize` / `pageMargins` are field-merged (a partial — e.g.
  just `orientation` or `topTwips` — stays valid); other fields replace
  wholesale, and an explicit `undefined` clears an optional one. The headless
  peer exposes the same change as `applySectionProperties` for Y.Doc parity.
  The new `SectionPropertiesPatch` type is exported.

- b11897b: Add `editor.styles` — define, update, and remove the named-style
  definitions (`SobreeDocument.styles`) content resolves through. Applying a
  `styleId` to content already works (`applyBlockProperties` /
  `applyRunProperties`); this is the complementary surface for the style
  definitions themselves.

  ```ts
  editor.styles.define(
    namedStyle("Caption", { runDefaults: { italic: true } }),
  );
  editor.styles.update("Heading1", { runDefaults: { color: "#1A5276" } });
  editor.styles.remove("Caption");
  ```

  Grouped under the `editor.styles` sub-object (mirrors `editor.table` /
  `editor.sections`). `update` replaces each present field wholesale and
  clears an optional one on explicit `undefined`; required `type` /
  `displayName` are never cleared. Mirrored on HeadlessSobree
  (`defineStyle` / `updateStyle` / `removeStyle`) with Y.Doc parity. New
  `NamedStylePatch` type exported.

## 0.1.15

### Patch Changes

- 26988fb: Expand the AST builder layer so structured content can be constructed
  programmatically without hand-written object literals, and reorganise the
  builders into a cohesive `doc/builders/` module (import path unchanged).

  New builders: `table` / `tableRow` / `tableCell` (with shading, borders,
  gridSpan, vMerge, vAlign), `hyperlink`, `field`, `tab`, `columnBreak`,
  `image`, `footnoteRef`, `commentRef`, `sectionBreak`, and `namedStyle`.
  They follow one convention — content positional, optional formatting in a
  trailing `properties` argument (or a single options object for many-field
  nodes), native OOXML units. Existing builders are unchanged.

## 0.1.14

### Patch Changes

- 73cdf48: Fix vertical height drift from two compensating defaults, so documents
  that specify no font size render at the correct height (and one-page
  content stops spilling onto a second page).
  - **Default run font size is now 10pt** (the OOXML application default),
    not 11pt. 11pt only applies when a document's `<w:docDefaults>`
    explicitly sets `sz=22` (the `Normal.dotm` template value); a document
    that specifies no size anywhere renders at 10pt in both Word and
    LibreOffice. Sobree's 11pt last-resort baseline over-sized every line
    of such documents by 10%.
  - **Calibri now uses the uniform 1.15 natural leading.** The earlier 1.05
    special-case was a mis-calibration that compensated for the 11pt bug
    (11 × 1.05 happened to equal the true 10 × 1.15 for `line=360`). With
    the size corrected, the genuine 1.15 leading applies to every font.

  Net effect across the corpus is a broad fidelity improvement (e.g.
  complex-multipage line drift dropped ~80%), with no regressions.
  Documents that explicitly set a font size, and new content created in the
  editor, are unaffected.

- 6392789: fix(table): resolve table-style conditional formatting (shading, banding, grid)

  Tables that get their appearance from a `<w:style w:type="table">` rather
  than direct cell formatting rendered flat — no header fill, no row banding,
  no grid lines. The importer dropped table styles entirely and the renderer
  only honoured a cell's own `<w:shd>` / `<w:tblBorders>`, so a document whose
  header colour and gridlines live in the style (the common case for Word's
  built-in and theme table styles) lost them on import.

  Now the full table-style cascade resolves per cell, per ECMA-376 §17.7.6:
  - Parse `<w:style w:type="table">` — base `<w:tblBorders>` + band sizes,
    whole-table `<w:tcPr>` shading, and every `<w:tblStylePr>` conditional
    region (`firstRow`/`lastRow`/`firstCol`/`lastCol`, row/column banding,
    corner cells) into `NamedStyle.tableStyle`, merged up the `basedOn` chain.
  - Read `<w:tblLook>` (which conditional formats are active, with the
    `noHBand`/`noVBand` → banding-on inversion) and per-cell `<w:tcBorders>`.
  - Resolve each cell's shading + border overrides at render time in
    precedence order (whole-table → banding → first/last column → first/last
    row → corner cells), with direct cell formatting still winning, and band
    ranges correctly excluding the first/last row/column when those are active.

  The table style's base borders now also draw the grid when the table
  declares none of its own. Existing tables (direct `<w:shd>`, `TableGrid`,
  explicit-none borders) are unchanged.

  Two related border/spacing fidelity fixes ride along:
  - **Inside vs. outer borders are now distinct.** Cell borders are drawn
    per edge by position instead of via a uniform CSS `border` on every
    cell, so a style that declares only `insideH`/`insideV` (interior
    gridlines) no longer paints a perimeter frame the document never asked
    for. Fully-bordered tables (`TableGrid`, explicit four-sides + inside)
    render the identical grid as before.
  - **Cell padding (`<w:tblCellMar>` / `<w:tcMar>`) is honoured.** The
    table's (or style's) default cell margins now apply as cell padding, so
    cells get their authored breathing room instead of sitting flush against
    the gridlines.

## 0.1.13

### Patch Changes

- 6887618: Make the optional version badge legible on any background — render it as
  a pill with its own background + shadow, so bare grey text no longer
  vanishes where the badge overlaps a dark region.

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
