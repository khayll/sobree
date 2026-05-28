# InlineFrame — design doc

> **Status**: IMPLEMENTED. This records the design and rationale behind
> the `InlineFrame` model that replaced the legacy
> `liftTextBoxContent` + `framePictures` + `liftedFromTextBox` +
> `textboxShape` machinery. The migration (Phases 1.0–1.4 below, plus
> the later anchored-frame flow conversion) has shipped; the legacy
> lifter is gone. Sections written in future tense are kept verbatim as
> the original plan-of-record — read them as "what was done," not "what
> is pending."

## The problem this solves

OOXML represents a "section heading frame" (the styled-pill section
headings common in templated CVs and reports) as:

```xml
<w:p>                                     ← outer paragraph (often empty)
  <w:pPr>
    <w:pageBreakBefore/>                  ← may carry break directive
  </w:pPr>
  <w:r>
    <w:drawing>
      <wp:inline>
        <a:graphic>
          <a:graphicData>
            <wpg:wgp>                     ← drawing group
              <wps:wsp>                   ← textbox shape
                <wps:spPr>
                  <a:xfrm>                ← shape's intra-group offset+size
                    <a:off x="..." y="..."/>
                    <a:ext cx="..." cy="..."/>
                  </a:xfrm>
                </wps:spPr>
                <wps:txbx>
                  <w:txbxContent>
                    <w:p>Heading text</w:p>
                  </w:txbxContent>
                </wps:txbx>
              </wps:wsp>
              <pic:pic>                   ← decorative background picture(s)
                ...
              </pic:pic>
            </wpg:wgp>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing>
  </w:r>
</w:p>
```

Visually this is ONE block: a styled rectangle, painted with a picture
background, containing centred bold text. Conceptually it's ONE
unit: selectable as a frame, picture and text are coupled, the
break-before directive belongs to the whole unit.

## What the current ("lifter") model does — and why it's wrong

`liftTextBoxContent` in `docx/import/index.ts` parses the XML above and:

1. Pulls every `<w:p>` out of every `<w:txbxContent>` and INSERTS them
   into the body XML as siblings of the OUTER `<w:p>` (which it then
   removes the `<w:drawing>` from).
2. Stamps each lifted paragraph with `data-sobree-lift-id` so the
   renderer can group them back together.
3. Stamps the FIRST lifted paragraph with `data-sobree-frame-pictures`
   (JSON-serialised decorative-picture descriptors) AND
   `data-sobree-textbox-shape` (JSON-serialised shape geometry).
4. The format walker (`paragraphs.ts`) parses these attributes back
   into `ParagraphProperties.liftedFromTextBox` / `.framePictures` /
   `.textboxShape`.
5. The renderer (`renderBlocks` in `block.ts`) sees these properties
   on otherwise-normal Paragraph blocks and branches into bespoke
   wrapping logic (`renderSectionFrame`, `currentTextBox` grouping).

Five different layers participating in one OOXML feature. Each handoff
is via stringly-typed DOM attributes. The break-before directive
attached to the OUTER paragraph ends up on the inner `<p>` element
inside the wrapper, where the paginator (which inspects the wrapper)
doesn't see it. Every property of the unit lives in a different
place. No place owns "this is one frame."

Concretely, this is what produced today's bugs:

- `pageBreakBefore` on a section-heading-bearing paragraph silently
  ignored by the paginator (because it lives on the inner `<p>`,
  not the wrapper div) — drops page-break directives that drive
  page count on decorated multi-page documents.
- Decorative pictures stamped only on the FIRST lifted paragraph;
  multi-textbox drawings lose decorations on textbox 2+.
- Section frames had to be detected by a heuristic on `framePictures`
  presence + size + coverage. The OOXML clearly says "this is a
  textbox shape with a background picture" — the renderer should
  read that, not guess.

## The new model

```ts
// packages/core/src/doc/types.ts

export type Block = Paragraph | Table | SectionBreak | InlineFrame;

/**
 * A rectangular drawing region that flows inline with body blocks
 * (NOT absolutely positioned — that's `AnchoredFrame`). Owns its own
 * picture decoration(s), its own textbox body (recursive Block[]),
 * and its own break / keep-with-next directives. Maps 1:1 to
 * `<w:drawing><wp:inline>` with a single `<wpg:wgp>` payload.
 *
 * Replaces the lifter's split-into-multiple-Paragraphs approach. One
 * frame = one block. The page-break directive that belonged to the
 * containing paragraph in the source moves to InlineFrame.pageBreakBefore,
 * where the paginator's top-level-child inspection will see it.
 */
export interface InlineFrame {
  kind: "inline_frame";

  /** From the containing `<w:p>`'s `<w:pPr>`. Drives forced page
   *  breaks; the paginator emits a `Penalty(-Infinity)` before the
   *  frame when set. */
  pageBreakBefore?: boolean;

  /** From the containing `<w:p>`'s `<w:pPr>`. Keep with the next
   *  block (widow/orphan-style). */
  keepNext?: boolean;

  /** The drawing group's intrinsic coordinate-system extent — every
   *  child's offset/extent below is expressed in this space. The
   *  renderer scales children proportionally when the frame is
   *  rendered at a different size. */
  groupExtentEmu: { wEmu: number; hEmu: number };

  /** The frame's RENDERED display dimensions. Usually equals
   *  `groupExtentEmu` for inline frames (no scaling), but kept
   *  separate so a future "render at half-size" option doesn't
   *  require touching the children. */
  sizeEmu: { wEmu: number; hEmu: number };

  /** The textbox SHAPE's intra-group position+size. The renderer
   *  uses this to place body content at the EXACT coordinates the
   *  author intended (not via heuristic padding). Optional because
   *  some drawings have a picture but no textbox. */
  textbox?: {
    offsetEmu: { xEmu: number; yEmu: number };
    sizeEmu: { wEmu: number; hEmu: number };
    /** Recursive body — paragraphs, tables, even nested frames.
     *  Renders inside the textbox's positioned region. */
    body: Block[];
    fill?: string;
    border?: BorderSpec;
    padding?: { topEmu: number; rightEmu: number; bottomEmu: number; leftEmu: number };
  };

  /** Decorative pictures inside the group. Each at its own
   *  intra-group position. The renderer paints them as
   *  absolute-positioned `<img>` elements inside the frame
   *  wrapper, scaled by `sizeEmu / groupExtentEmu`. */
  pictures: ReadonlyArray<{
    partPath: string;
    offsetEmu: { xEmu: number; yEmu: number };
    sizeEmu: { wEmu: number; hEmu: number };
  }>;

  /** Other shapes inside the group (rect / ellipse / line) —
   *  decorative non-picture geometry. Same positioning model as
   *  `pictures`. */
  shapes: ReadonlyArray<{
    geometry: "rect" | "ellipse" | "roundedRect" | "line";
    offsetEmu: { xEmu: number; yEmu: number };
    sizeEmu: { wEmu: number; hEmu: number };
    fill?: string;
    border?: BorderSpec;
  }>;
}

export interface BorderSpec {
  color: string;
  widthEmu: number;
  style: "solid" | "dashed" | "dotted" | "double";
}
```

## Why this design is right

1. **One concept → one type → one module**: an inline drawing-frame is
   exactly one `InlineFrame`. The importer parses it as one. The
   renderer renders it as one. The paginator measures it as one.
2. **Source-data flows through, not heuristics**: every field is
   directly read from the OOXML. No "if picture covers ≥70% of group,
   treat as band; if aspect < 0.5, treat as sidebar; else banner."
   The picture is at `pictures[i].offsetEmu`. The textbox text is at
   `textbox.offsetEmu`. Coverage and aspect are computed at render
   time from the data, not assumed at import.
3. **Page-break directive lives in the right place**: on the frame
   itself, where the paginator's top-level-child inspection finds it.
4. **Recursive**: `textbox.body: Block[]` — a frame can contain
   paragraphs, tables, even nested frames. Same renderer recursion as
   `renderBlocks(host, blocks)` already does.
5. **No more stringly-typed attributes**: no `data-sobree-frame-pictures`,
   no `data-sobree-textbox-shape`, no `data-sobree-lift-id`. The
   pipeline carries typed AST nodes end-to-end.
6. **The 54 `block.kind` switch sites in the codebase** get one new
   branch each, surfaced by TypeScript's exhaustiveness check. No
   hidden silent fall-throughs.

## Migration plan

**Phase 1.0** *(this turn)* — types + design doc. Add `InlineFrame` to
the `Block` union. Add stub handlers to every `block.kind` switch
(treating `InlineFrame` as an empty paragraph for backward compat —
the importer doesn't emit it yet). Tests + corpus stay green.

**Phase 1.1** — importer emits `InlineFrame`. New `parseInlineFrames`
in `docx/import/` handles `<w:drawing><wp:inline>` with a textbox
payload. The lifter is taught to SKIP drawings the new parser handles.
Bypass for everything else (anchored drawings, drawings without
textboxes — for now those still go through the lifter).

**Phase 1.2** — renderer handles `InlineFrame`. New `renderInlineFrame`
in `editor/view/docRenderer/`. Outputs a positioned wrapper div with
picture overlays + recursive body render. `renderSectionFrame` is
deleted; its consumers route through the new path.

**Phase 1.3** — visual verification per fixture. Every corpus fixture
that exercises section frames renders to PNG; side-by-side diff vs the
LibreOffice reference. Snapshots regenerated only when the visual is
at-least-as-correct as before.

**Phase 1.4** — delete the lifter. Once all drawings with textboxes
flow through `InlineFrame`, `liftTextBoxContent` is unreachable for
that case. The `ParagraphProperties.liftedFromTextBox` /
`.framePictures` / `.textboxShape` fields become dead and get
deleted. `stampLiftAnchorOnParagraph`, `stampDecorativePicturesOnParagraph`,
`readTextboxShapeGeometry`, `collectDecorativePictures` — all dead.
~600 lines deleted; the section-frame branch in `renderBlocks`
disappears.

**Phase 2** — paginator refactor (separate doc).

## What this does NOT solve directly

- Anchored drawings (`<wp:anchor>`) — still go through `AnchoredFrame`
  (parallel concept, separate doc). Long term `InlineFrame` and
  `AnchoredFrame` may share infrastructure, but they have different
  positioning semantics (inline-in-flow vs absolute-on-page).
- The paginator's forced-break + overflow behaviour — Phase 2.
- VML `<w:pict>` legacy fallback — out of scope for Phase 1.

## What needs to be true after Phase 1.4

- `Block.kind === "inline_frame"` is the ONLY way a section heading
  is represented in the AST.
- No `Paragraph.liftedFromTextBox`, no `Paragraph.framePictures`, no
  `Paragraph.textboxShape`.
- No `liftTextBoxContent` function.
- No `data-sobree-*` attributes carrying picture / shape / lift state.
- `renderSectionFrame` is deleted; its responsibilities are inside
  `renderInlineFrame`.
- Every fixture's snapshot regenerates ONCE and stays stable.
- Page-break-before on section headings WORKS — the paginator sees the
  directive on the InlineFrame block, not buried on a child paragraph.
