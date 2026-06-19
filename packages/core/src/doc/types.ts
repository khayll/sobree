/**
 * Sobree's internal document model.
 *
 * Every node here maps 1-to-1 to an OOXML construct so serialisation to
 * `.docx` is mechanical (no decisions, no lossy translation). The names
 * are JS-friendly — `Paragraph`, `RunProperties`, etc. — rather than
 * `<w:p>`, `<w:rPr>` directly, but the shapes line up.
 *
 * Conventions:
 *   - All numeric measurements that originate in OOXML keep their native
 *     unit, suffixed in the field name: `wTwips`, `sizeHalfPt`, `widthEmu`.
 *   - All node objects are JSON-clean (no functions, classes, or
 *     references) so they cross any wire (Yjs sync messages, MCP,
 *     postMessage) untouched.
 *   - Optional fields are `?:` — absence means "not set", not "default".
 *     Defaults are applied at render time from the document's styles.
 */

// Formatting primitives (borders, shading, cell spacing) and the
// table-style conditional-formatting model live in dependency-free leaf
// modules — none reference the recursive `Block` graph, so keeping them
// out of `types.ts` avoids a circular import. Imported here for the fields
// that reference them, and re-exported so consumers keep importing every
// AST type from `./types`.
import type {
  BorderSpec,
  Shading,
  TableBorders,
  TableCellBorders,
  TableCellMargins,
} from "./formatting.types";
import type { TableLook, TableStyleDefinition } from "./tableStyle.types";
export type {
  BorderSpec,
  Shading,
  TableBorders,
  TableCellBorders,
  TableCellMargins,
} from "./formatting.types";
export type {
  TableConditionalType,
  TableLook,
  TableStyleCellFormat,
  TableStyleDefinition,
} from "./tableStyle.types";

// === document ===

export interface SobreeDocument {
  /** Top-level body content, in document order. */
  body: Block[];
  /**
   * One section per body slice. The simplest doc has exactly one section
   * spanning the whole body. Phase N1 supports a single-section model.
   */
  sections: SectionProperties[];
  /**
   * Header and footer bodies keyed by `HeaderFooterRef.partId`. The partId
   * is the ZIP target name (`header1.xml`, `footer2.xml`, …). Rendering
   * emits each body to its own OOXML part at export time.
   */
  headerFooterBodies: Record<string, Block[]>;
  /**
   * Floating objects that live inside a header/footer part, keyed by the
   * SAME `HeaderFooterRef.partId` as `headerFooterBodies`. A header part
   * is a self-contained sub-document: its flow blocks live in
   * `headerFooterBodies[partId]`, its anchored frames here. The renderer
   * paints these into a per-zone overlay exactly like body `anchoredFrames`.
   * Empty/absent for the common header-without-floats case.
   */
  headerFooterFrames?: Record<string, AnchoredFrame[]>;
  /** Named styles (Heading1, Quote, Body Text, …) defined at the doc level. */
  styles: NamedStyle[];
  /** List/numbering definitions referenced by `Paragraph.properties.numbering`. */
  numbering: NumberingDefinition[];
  /**
   * Embedded binary parts keyed by ZIP path (e.g. `word/media/image1.png`).
   * Images, fonts, custom XML — anything not represented in body XML.
   */
  rawParts: Record<string, Uint8Array>;
  /**
   * Font declarations from `word/fontTable.xml`. Empty for new docs.
   * Embedded faces reference parts inside `rawParts`.
   */
  fonts: FontDeclaration[];
  /**
   * Footnote bodies keyed by id. Body inline runs use `FootnoteRefRun`
   * with the matching `id` to reference them. Empty for docs without
   * footnotes (the common case).
   */
  footnotes?: Record<number, Block[]>;
  /**
   * Comments keyed by id. Body inline runs whose properties carry a
   * matching `commentIds` mark the range each comment annotates.
   * Empty for docs without comments (the common case).
   */
  comments?: Record<number, Comment>;
  /**
   * Document-wide layout settings parsed from `word/settings.xml`.
   * Currently only `defaultTabStopTwips` — Word's default interval for
   * tab advances in paragraphs that don't declare their own `<w:tabs>`
   * stops. Word's factory default is 720 twips (0.5"). Without
   * respecting this, the browser falls back to the CSS `tab-size`
   * default of 8 characters which is much narrower than what Word
   * shows, and tab-aligned content (e.g. label/value columns in
   * letterheads) ends up cramped.
   */
  settings?: {
    defaultTabStopTwips?: number;
  };
  /**
   * NOTE: inline-drawing frames are emitted as `InlineFrame` BLOCKS
   * directly in `body` (the importer splices them in at their source
   * paragraph's position via `ConvertOptions.replaceParagraphs`), so
   * they paginate in document flow. This optional top-level list is
   * a secondary handle kept for tooling/inspection; the renderer
   * consumes the body blocks, not this list.
   *
   * The first-class model replaced the old `liftTextBoxContent`
   * machinery that exploded section-heading textboxes into body
   * paragraphs with synthetic `framePictures` / `liftedFromTextBox`
   * metadata. See `packages/core/docs/INLINE_FRAME_DESIGN.md`.
   */
  inlineFrames?: InlineFrame[];
  /**
   * Floating objects (`<w:drawing>/<wp:anchor>`, `<w:pict>` VML) that
   * live in their own layer above the body. Each frame carries its
   * own coordinates + dimensions in EMU and is independent of
   * pagination — the paginator only sees `body` blocks. The renderer
   * places each frame on the page its anchor resolves to and paints
   * it into a per-page `<div class="paper-anchors">` overlay.
   *
   * Replaces the pre-AnchoredFrame "lifter" architecture where the
   * importer exploded each `<w:txbxContent>` into N body paragraphs
   * with synthetic `liftedFromTextBox` metadata. The flat list here
   * is simpler, makes selection / resize / move trivial (each frame
   * is one DOM element), and frees the paginator from having to
   * route around absolute-positioned ghosts.
   */
  anchoredFrames?: AnchoredFrame[];
}

// === anchored frames (floating layer) ===

/**
 * A floating object pinned to a page or paragraph at an explicit
 * coordinate. Sources: `<w:drawing>/<wp:anchor>` shapes,
 * `<w:pict>` VML boxes.
 *
 * Coordinates use OOXML's EMU (914400 EMU = 1 inch). The renderer
 * converts to CSS millimetres at paint time.
 */
export interface AnchoredFrame {
  /** Stable id, deterministic from document import order. */
  id: string;
  /** What the offsets are measured from. */
  anchor: AnchorOrigin;
  offsetXEmu: number;
  offsetYEmu: number;
  widthEmu: number;
  heightEmu: number;
  /** Stacking order. Higher = on top. Default 0. */
  zIndex?: number;
  /** When true the frame paints BEHIND body text (z-index negative).
   *  Maps to OOXML `<wp:anchor behindDoc="1">`. */
  behindText?: boolean;
  /** Text-wrap mode from the `<wp:wrap*>` child of `<wp:anchor>`.
   *  Decides whether the frame DISPLACES body flow: `square` /
   *  `topAndBottom` / `tight` / `through` reserve vertical space (the
   *  paginator treats the anchor paragraph as that tall), while `none`
   *  floats over text and reserves nothing. Absent ⇒ unknown (treated
   *  as non-displacing). */
  wrap?: "square" | "topAndBottom" | "tight" | "through" | "none";
  /** `wrapText` side from `<wp:wrapSquare|Tight|Through wrapText="…">` —
   *  which sides of the frame body text flows on. Default `bothSides`.
   *  Only meaningful for the displacing wrap modes; drives whether a
   *  floated image goes `float: left` (text on the right) or `right`. */
  wrapText?: "bothSides" | "left" | "right" | "largest";
  /** Text-distance insets — `distT/B/L/R` on `<wp:anchor>`, in EMU. The
   *  gap Word keeps between the frame and the text wrapping around it;
   *  rendered as margins on the floated frame. */
  textDistancesEmu?: { topEmu: number; rightEmu: number; bottomEmu: number; leftEmu: number };
  /** What this frame contains. */
  content: AnchoredContent;
}

/**
 * Where an anchored frame is positioned and which page receives it.
 *
 *   - `sectionIndex` decides which section's pages are candidates.
 *   - `paragraphIndex` (optional) ties the frame to a specific body
 *     paragraph — useful when `verticalFrom: "paragraph"` so the
 *     frame floats to whichever page the paragraph paginates onto.
 *     When absent, the frame is page-relative (lands on the first
 *     page of its section).
 *   - `horizontalFrom` / `verticalFrom` mirror OOXML's
 *     `relativeFromH` / `relativeFromV` enums.
 */
export interface AnchorOrigin {
  sectionIndex: number;
  paragraphIndex?: number;
  horizontalFrom: "page" | "margin" | "column";
  verticalFrom: "page" | "margin" | "paragraph";
}

/**
 * What an AnchoredFrame contains. Closed union — adding a new variant
 * requires both importer and renderer support.
 *
 *   - "picture" — a single image from `rawParts`. The frame's
 *     widthEmu / heightEmu give the display size; the picture
 *     stretches to fill (matches Word's default sizing behaviour).
 *
 *   - "textbox" — rich body content. Renders recursively via
 *     `renderBlocks` inside the frame, with `overflow: hidden` so
 *     text that exceeds the frame's height clips (Word behaviour).
 *     Optional fill / border / padding paint the textbox chrome.
 *
 *   - "shape" — a vector primitive (filled rectangle, ellipse,
 *     rounded-rect). No text. Used for decorative backgrounds and
 *     dividers (dotted lines, banner rectangles).
 *
 *   - "group" — wraps other frames at NESTED coordinates. The
 *     children's offsets are interpreted in the group's local
 *     coordinate system, scaled to fill `widthEmu × heightEmu`.
 *     Maps to OOXML `<wpg:wgp>`. This is how a single project
 *     heading carries its rounded-rect frame + atom icon + arrow
 *     stripe as ONE selectable unit.
 */
export type AnchoredContent =
  | { kind: "picture"; partPath: string; altText?: string }
  | {
      kind: "textbox";
      body: Block[];
      fill?: string;
      border?: { color: string; widthEmu: number; style: "solid" | "dashed" | "dotted" | "double" };
      padding?: { topEmu: number; rightEmu: number; bottomEmu: number; leftEmu: number };
    }
  | {
      kind: "shape";
      geometry: "rect" | "ellipse" | "roundedRect" | "line" | "custom";
      fill?: string;
      border?: { color: string; widthEmu: number; style: "solid" | "dashed" | "dotted" | "double" };
      /** Present when `geometry === "custom"`: a DrawingML `<a:custGeom>`
       *  outline as an SVG path in its own `widthEmu × heightEmu` box,
       *  rendered as a scaled `<svg><path>`. Absent for preset geometry. */
      path?: { widthEmu: number; heightEmu: number; d: string };
    }
  | {
      kind: "group";
      children: AnchoredFrame[];
      /** Local coordinate system extent (`<a:chExt>`). A child at offset
       *  `P` maps into the group's rendered box as
       *  `(P − childCoordOffset) × (size / childCoordSystem)` — the
       *  extent gives the scale. */
      childCoordSystemCx: number;
      childCoordSystemCy: number;
      /** Local coordinate system ORIGIN (`<a:chOff>`). Child offsets are
       *  measured from this point, not from 0 — so it must be subtracted
       *  before scaling, or the children shift by `chOff × scale`.
       *  Absent ⇒ origin is `(0, 0)` (the common case). */
      childCoordOffsetX?: number;
      childCoordOffsetY?: number;
    };

export interface Comment {
  id: number;
  author?: string;
  /** Author initials as recorded in the docx — Word uses them in the
   *  comment sidebar header. */
  initials?: string;
  /** ISO-8601 date string. */
  date?: string;
  /** Comment body — typically one or more paragraphs. */
  body: Block[];
  /**
   * Resolved / "Done" flag from `word/commentsExtended.xml`
   * (`<w15:commentEx w15:done="1">`). Absent or false → open.
   */
  done?: boolean;
  /**
   * Id of the parent comment when this is a reply in a thread.
   * Resolved from `<w15:commentEx w15:paraIdParent="…">` by matching
   * the parent's body-paragraph paraId back to its comment id.
   * Absent → top-level comment.
   */
  replyToId?: number;
}

// === fonts (word/fontTable.xml) ===
//
// `FontDeclaration` + `FontEmbedRef` live in `../fonts/types` so the
// fonts module owns its own AST shapes. Re-imported and re-exported
// here so existing consumers keep importing `FontDeclaration` from
// `doc/types` and `SobreeDocument.fonts` resolves its type.
import type { FontDeclaration as _FontDeclaration } from "../fonts/types";
export type { FontDeclaration, FontEmbedRef } from "../fonts/types";
// Internal alias kept so the `SobreeDocument` declaration above can
// reference the type without forcing every reader to also import
// from `../fonts/types`.
type FontDeclaration = _FontDeclaration;

// === blocks ===

export type Block = Paragraph | Table | SectionBreak | InlineFrame;

export interface Paragraph {
  kind: "paragraph";
  properties: ParagraphProperties;
  /** Inline runs in document order. May be empty (a blank paragraph). */
  runs: InlineRun[];
}

/** Explicit page-break or section-break marker emitted between paragraphs. */
export interface SectionBreak {
  kind: "section_break";
  /** Which section in `SobreeDocument.sections` continues after this point. */
  toSectionIndex: number;
}

/**
 * A rectangular drawing region that flows inline with body blocks
 * (NOT absolutely positioned — that's `AnchoredFrame`). Owns its own
 * picture decoration(s), its own textbox body (recursive `Block[]`),
 * and its own break / keep-with-next directives. Maps 1:1 to
 * `<w:drawing><wp:inline>` with a `<wpg:wgp>` payload that wraps a
 * `<wps:txbx>` textbox shape + decorative `<pic:pic>` / `<wps:wsp>`
 * siblings.
 *
 * Replaces the legacy lifter's "split into N body paragraphs with
 * `liftedFromTextBox` + `framePictures` + `textboxShape` glued on"
 * approach. One frame = one block. The page-break directive that
 * belonged to the containing paragraph in the source OOXML moves
 * here (`pageBreakBefore`), where the paginator's top-level-child
 * inspection actually finds it.
 *
 * See `packages/core/docs/INLINE_FRAME_DESIGN.md` for the full
 * design and migration plan.
 *
 * **Status**: type declared (Phase 1.0). Importer does not yet emit
 * this; renderer treats it as a no-op. Wiring lands in Phase 1.1-1.2.
 */
/** One textbox shape inside an inline-frame group: its intra-group
 *  position + size and recursive body, plus optional chrome (fill /
 *  border / text insets) and vertical text anchor. */
export interface InlineFrameTextbox {
  offsetEmu: { xEmu: number; yEmu: number };
  sizeEmu: { wEmu: number; hEmu: number };
  body: Block[];
  fill?: string;
  border?: FrameBorder;
  /** `<wps:bodyPr>` text insets (lIns/tIns/rIns/bIns) → CSS padding. */
  padding?: {
    topEmu: number;
    rightEmu: number;
    bottomEmu: number;
    leftEmu: number;
  };
  /** Vertical text anchor from `<wps:bodyPr anchor>`; defaults to "top". */
  vAlign?: "top" | "center" | "bottom";
}

export interface InlineFrame {
  kind: "inline_frame";

  /** From the containing `<w:p>`'s `<w:pPr>`. The paginator emits a
   *  `Penalty(-Infinity)` before the frame when set. */
  pageBreakBefore?: boolean;

  /** From the containing `<w:p>`'s `<w:pPr>`. Keep with the next
   *  block to avoid widowing a section heading from its body. */
  keepNext?: boolean;

  /** The containing `<w:p>`'s resolved paragraph properties. An inline
   *  drawing lives inside a host paragraph; that paragraph carries
   *  spacing (before/after), alignment, etc. from its style cascade
   *  (commonly `Normal`'s `<w:spacing w:after>`). The renderer applies
   *  these to the frame wrapper so the band reserves the SAME vertical
   *  box (drawing height + paragraph spacing) Word does — without it
   *  the band is short by the spacing-after, which compounds down the
   *  page and shifts pagination. Absent → wrapper uses bare defaults. */
  hostProps?: ParagraphProperties;

  /** The drawing group's intrinsic coordinate-system extent. Every
   *  child's `offsetEmu` / `sizeEmu` below is expressed in this
   *  space; the renderer scales them by `sizeEmu / groupExtentEmu`
   *  when painting at the final rendered size. */
  groupExtentEmu: { wEmu: number; hEmu: number };

  /** The frame's rendered display dimensions. Usually equal to
   *  `groupExtentEmu` for inline drawings (no scaling) but kept
   *  separate so a future "render at half-size" / scaling case
   *  doesn't require touching every child. */
  sizeEmu: { wEmu: number; hEmu: number };

  /** The group's textbox SHAPES, in document (child) order. Most groups
   *  have one (a section "pill" heading: a centred line over a background
   *  picture), but a "Project: X" entry has two — a title textbox and a
   *  details textbox — and the renderer must show BOTH. Empty when the
   *  group carries only pictures / shapes (no textbox content). */
  textboxes: InlineFrameTextbox[];

  /** Decorative pictures inside the group. Each carries its own
   *  intra-group position. The renderer paints them as
   *  absolute-positioned `<img>` children of the frame wrapper,
   *  scaled by the same `sizeEmu / groupExtentEmu` ratio. */
  pictures: ReadonlyArray<{
    partPath: string;
    offsetEmu: { xEmu: number; yEmu: number };
    sizeEmu: { wEmu: number; hEmu: number };
    altText?: string;
  }>;

  /** Non-picture decorative shapes (rect / ellipse / line) inside
   *  the group. Same positioning model as `pictures`. */
  shapes: ReadonlyArray<{
    geometry: "rect" | "ellipse" | "roundedRect" | "line";
    offsetEmu: { xEmu: number; yEmu: number };
    sizeEmu: { wEmu: number; hEmu: number };
    fill?: string;
    border?: FrameBorder;
  }>;
}

/** Shared border descriptor for inline / anchored frame chrome.
 *  Distinct from `BorderSpec` (used for paragraph / table borders
 *  whose OOXML `w:val` covers a different vocabulary). */
export interface FrameBorder {
  color: string;
  widthEmu: number;
  style: "solid" | "dashed" | "dotted" | "double";
}

// === inline runs ===

export type InlineRun =
  | TextRun
  | BreakRun
  | TabRun
  | FieldRun
  | DrawingRun
  | HyperlinkRun
  | FootnoteRefRun
  | CommentRefRun;

export interface TextRun {
  kind: "text";
  text: string;
  properties: RunProperties;
}

export interface BreakRun {
  kind: "break";
  /**
   * `line` — soft line break inside a paragraph (Shift-Enter).
   * `page` — explicit page break.
   * `column` — column break in a multi-column section.
   */
  type: "line" | "page" | "column";
  properties?: RunProperties;
}

export interface TabRun {
  kind: "tab";
  properties?: RunProperties;
}

export interface FieldRun {
  kind: "field";
  /** Field instruction text — `PAGE`, `NUMPAGES`, `DATE`, `AUTHOR`, … */
  instruction: string;
  /**
   * Cached value displayed if a viewer doesn't recalculate. Used as the
   * preview text by Sobree's renderer.
   */
  cached?: string;
  properties?: RunProperties;
}

/**
 * Inline reference to a comment (`<w:commentReference w:id="N"/>`).
 * Word renders a small balloon icon at the position; we mirror with
 * a clickable inline span linking to the comment card in the aside.
 */
export interface CommentRefRun {
  kind: "commentRef";
  /** ID matching a key in `SobreeDocument.comments`. */
  id: number;
  properties?: RunProperties;
}

/**
 * Inline reference to a footnote (`<w:footnoteReference w:id="N"/>`).
 * Renders as a clickable superscript number; the referenced footnote's
 * body lives in `SobreeDocument.footnotes[id]` and is rendered at the
 * end of the document. (True per-page pinning is a paginator feature
 * deferred for now.)
 */
export interface FootnoteRefRun {
  kind: "footnoteRef";
  /** ID matching a key in `SobreeDocument.footnotes`. */
  id: number;
  properties?: RunProperties;
}

export interface DrawingRun {
  kind: "drawing";
  /** Path of the embedded media part in `rawParts` (e.g. `word/media/image1.png`). */
  partPath: string;
  /** Rendered size. */
  widthEmu: number;
  heightEmu: number;
  /** Accessibility text. */
  altText?: string;
  /**
   * Where the image lays out:
   *   - "inline"  — flows in the paragraph like a tall character.
   *   - "anchor"  — positioned absolutely (`<wp:anchor>`); `anchor`
   *                 carries the offset + frame-of-reference.
   *   - "floatLeft" / "floatRight" — a `<wp:anchor>` image with a
   *                 displacing wrap (square/tight/through), converted to a
   *                 CSS float at the head of its anchor paragraph so body
   *                 text flows around it. `floatMarginsEmu` carries the
   *                 `distT/B/L/R` clearance.
   */
  placement: "inline" | "anchor" | "floatLeft" | "floatRight";
  /** Set when `placement === "anchor"`. */
  anchor?: DrawingAnchor;
  /** Set for `floatLeft` / `floatRight` — the text-clearance margins
   *  (from the frame's `distT/B/L/R`), applied as CSS margins. */
  floatMarginsEmu?: { topEmu: number; rightEmu: number; bottomEmu: number; leftEmu: number };
  /**
   * Vertical alignment for an `inline` image relative to the text on
   * its line. Defaults to the browser baseline (image bottom on the
   * text baseline). `"middle"` centres the image on the text — used
   * for a heading decoration (the flowed ► project arrow) that is
   * taller than its label, so the label centres beside it as Word
   * renders it. Omitted for ordinary inline images.
   */
  verticalAlign?: "baseline" | "middle";
}

export interface DrawingAnchor {
  /** Horizontal offset in EMU (English Metric Units; 914400 EMU = 1 inch). */
  offsetXEmu: number;
  /** Vertical offset in EMU. */
  offsetYEmu: number;
  /** What `offsetXEmu` is measured from. */
  relativeFromH: "page" | "margin" | "column" | "character";
  /** What `offsetYEmu` is measured from. */
  relativeFromV: "page" | "margin" | "paragraph" | "line";
  /** True when the image renders *behind* text (z-index negative). */
  behindDoc?: boolean;
}

export interface HyperlinkRun {
  kind: "hyperlink";
  /** Either an external URL or an internal anchor id. */
  href: string;
  /** Display text — itself a list of runs to allow nested formatting. */
  children: InlineRun[];
  properties?: RunProperties;
}

// === run properties ===

export interface RunProperties {
  /** Reference to a `NamedStyle.id` of type "character". */
  styleId?: string;
  bold?: boolean;
  italic?: boolean;
  /** Underline style — most callers want `"single"`. */
  underline?: "single" | "double" | "dotted" | "dashed" | "wave" | "none";
  strike?: boolean;
  doubleStrike?: boolean;
  /** `#rrggbb`. */
  color?: string;
  /** Word highlight name (`yellow`, `green`, …) or `#rrggbb`. */
  highlight?: string;
  /** Cell-style shading (`<w:shd w:fill="…">`). */
  shading?: Shading;
  /** Font family name (Calibri, Georgia, …). */
  fontFamily?: string;
  /** Size in points (Word stores half-points; we expose pt for ergonomics). */
  fontSizePt?: number;
  verticalAlign?: "subscript" | "superscript";
  /** Whether the text is uppercase / small caps. */
  caps?: boolean;
  smallCaps?: boolean;
  /** Hidden text (`<w:vanish/>`). */
  hidden?: boolean;
  /**
   * Tracked-change marker — set when the run is inside a `<w:ins>`
   * (insertion) or `<w:del>` (deletion) wrapper. The renderer
   * applies a visual revision style; the underlying text is preserved
   * either way so the document round-trips faithfully.
   */
  revision?: RevisionMark;
  /**
   * Comment ids whose `<w:commentRangeStart>` … `<w:commentRangeEnd>`
   * span includes this run. The renderer highlights ranges with any
   * active comment. Multiple ids let nested/overlapping comments
   * coexist on the same run.
   */
  commentIds?: readonly number[];
  /**
   * Tracked **format change** — a snapshot of this run's properties
   * *before* the most recent tracked formatting edit. Word stores this
   * as `<w:rPrChange>` (ECMA-376 §17.13.5.32).
   *
   * Accepting the format revision drops `revisionFormat` (the current
   * `properties` stays). Rejecting it restores `properties` *to* the
   * `before` snapshot. Repeated tracked format edits don't overwrite
   * the snapshot — the *original* properties stay captured, so a
   * reject always returns the run to its pre-tracking state.
   *
   * `before` is itself a `RunProperties` but `revisionFormat` doesn't
   * recurse (the snapshot is "what the run looked like before we
   * started tracking format changes").
   */
  revisionFormat?: {
    before: RunProperties;
    author?: string;
    date?: string;
  };
}

export interface RevisionMark {
  /** `ins` = insertion, `del` = deletion. */
  type: "ins" | "del";
  /** Author name as recorded in the docx (`<w:ins w:author="...">`). */
  author?: string;
  /** ISO-8601 timestamp string from the docx. */
  date?: string;
}

// === paragraph properties ===

export interface ParagraphProperties {
  /** Reference to a `NamedStyle.id` of type "paragraph". */
  styleId?: string;
  alignment?: ParagraphAlignment;
  /** Numbered/bulleted list reference. */
  numbering?: { numId: number; level: number };
  spacing?: ParagraphSpacing;
  indent?: ParagraphIndent;
  borders?: ParagraphBorders;
  shading?: Shading;
  /** Keep this paragraph on the same page as the next one. */
  keepNext?: boolean;
  /** Don't allow this paragraph to break across pages. */
  keepLines?: boolean;
  /** Insert a page break before this paragraph. */
  pageBreakBefore?: boolean;
  /** Custom tab stops from `<w:pPr><w:tabs>`, positions in twips. The
   *  renderer uses the smallest stop's position to compute a CSS
   *  `tab-size` on the paragraph so `\t` characters in the text honour
   *  the document's tab geometry instead of the browser's 8-char
   *  default. Mixed alignments (right / decimal / leader) collapse to
   *  "left" for now — covering the common case (label-value columns
   *  in headers + form fields). */
  tabStops?: readonly { positionTwips: number; alignment: string; leader?: string }[];
  /** Default run properties applied to runs that don't override. */
  runDefaults?: RunProperties;
  /**
   * Tracked-change marker on the paragraph mark itself. Semantically:
   * the *paragraph break that precedes this paragraph* is a tracked
   * change. Word stores this as `<w:rPr><w:ins/></w:rPr>` inside
   * `<w:pPr>` — see ECMA-376 §17.13.5.7.
   *
   *   `ins` — pressing Enter created this paragraph (split the prior
   *           paragraph). Accepting keeps the split; rejecting merges
   *           the paragraph back into the previous one.
   *   `del` — the user has marked this paragraph break for deletion
   *           (e.g. Backspace at the start of this paragraph in
   *           tracked mode). Accepting merges into the previous;
   *           rejecting keeps the split.
   *
   * Accept/reject of this paragraph-level marker is tracked under
   * follow-up task 26 (block-level revisions); v1 only adds the
   * authoring path (via `Editor.splitBlock` in track-changes mode).
   */
  revision?: RevisionMark;
}

export type ParagraphAlignment =
  | "left"
  | "center"
  | "right"
  | "both" // Word's term for "justify"
  | "distribute";

export interface ParagraphSpacing {
  /** Twips before the paragraph. */
  beforeTwips?: number;
  /** Twips after the paragraph. */
  afterTwips?: number;
  /** Twips between lines (when `lineRule === "exact" | "atLeast"`) or
   *  240ths of a multiplier (when `lineRule === "auto"`). */
  line?: number;
  lineRule?: "auto" | "exact" | "atLeast";
}

export interface ParagraphIndent {
  leftTwips?: number;
  rightTwips?: number;
  /** Indent of the first line of the paragraph (positive = indent in). */
  firstLineTwips?: number;
  /** Hanging indent (offsets first line OUT of the rest of the para). */
  hangingTwips?: number;
}

export interface ParagraphBorders {
  top?: BorderSpec;
  right?: BorderSpec;
  bottom?: BorderSpec;
  left?: BorderSpec;
  between?: BorderSpec;
}

// === tables ===

export interface Table {
  kind: "table";
  /** Column widths in twips. Length = number of columns. */
  grid: number[];
  rows: TableRow[];
  properties: TableProperties;
}

export interface TableProperties {
  /** Total table width in twips, or "auto" for content-driven. */
  widthTwips?: number;
  alignment?: ParagraphAlignment;
  borders?: TableBorders;
  /** Style reference (e.g. "TableGrid"). */
  styleId?: string;
  /** `<w:tblLook>` — which of the table style's conditional formats are
   *  active (first row / column, last row / column, row / column
   *  banding). Gates {@link TableStyleDefinition} resolution. */
  look?: TableLook;
  /** `<w:tblCellMar>` — default inner padding for every cell (the table's
   *  own value wins over the style's). Word's stock default is ~108 twips
   *  left / right and 0 top / bottom when omitted. */
  cellMargins?: TableCellMargins;
}

export interface TableRow {
  cells: TableCell[];
  /** True if this row is a header row repeated on each page. */
  isHeader?: boolean;
}

export interface TableCell {
  /** Number of grid columns this cell spans horizontally. */
  gridSpan?: number;
  /** Vertical merge state — `restart` begins a merge, `continue` continues. */
  vMerge?: "restart" | "continue";
  verticalAlign?: "top" | "center" | "bottom";
  shading?: Shading;
  borders?: TableCellBorders;
  /** Cell content — paragraphs and (rare) nested tables. */
  content: Block[];
}

// === sections (page setup, headers, footers) ===

export interface SectionProperties {
  pageSize: PageSize;
  pageMargins: PageMargins;
  /** Header references. Most docs have one or two. */
  headerRefs: HeaderFooterRef[];
  footerRefs: HeaderFooterRef[];
  /** Show the first-page header/footer slot if true. */
  titlePage?: boolean;
  /** Continuous, nextPage, etc. */
  type?: "continuous" | "nextPage" | "evenPage" | "oddPage";
  /**
   * Vertical alignment of the body content on each page in this section.
   * OOXML `<w:vAlign>` (ECMA-376 §17.6.21). Only visible on partial pages
   * — full pages have no slack to redistribute. Default is `"top"` (the
   * field is omitted in that case).
   *
   *   - `top`    — content anchored to top margin (default).
   *   - `center` — content centred between top and bottom margin.
   *   - `bottom` — content anchored to bottom margin.
   *   - `both`   — paragraph spacing stretched to fill the page.
   */
  vAlign?: "top" | "center" | "bottom" | "both";
  /**
   * Multi-column layout for the section's content (`<w:cols>`).
   * Absent or `count <= 1` → single column (the default; the renderer
   * does not wrap in a column container in that case).
   */
  columns?: SectionColumns;
}

export interface SectionColumns {
  /** Number of columns. */
  count: number;
  /** Default inter-column gap in twips (Word's `<w:cols w:space>`). Used
   *  for equal columns and as the fallback gap when a per-column space
   *  is absent. */
  spaceTwips?: number;
  /** `false` when the section declares explicit per-column widths
   *  (Word's `<w:cols w:equalWidth="0">`). Absent/`true` → equal columns,
   *  which the renderer flows with CSS multi-column. */
  equalWidth?: boolean;
  /** Per-column geometry from `<w:col w:w w:space>`, present only for the
   *  unequal case. `length === count`. Each entry's `spaceTwips` is the
   *  gap AFTER that column (the last column's is usually absent). The
   *  renderer flows blocks across these tracks at their true widths. */
  columns?: SectionColumn[];
}

export interface SectionColumn {
  /** Column width in twips (`<w:col w:w>`). */
  widthTwips: number;
  /** Trailing gap after this column in twips (`<w:col w:space>`). */
  spaceTwips?: number;
}

export interface PageSize {
  wTwips: number;
  hTwips: number;
  orientation: "portrait" | "landscape";
}

export interface PageMargins {
  topTwips: number;
  rightTwips: number;
  bottomTwips: number;
  leftTwips: number;
  headerTwips: number;
  footerTwips: number;
  gutterTwips: number;
}

export interface HeaderFooterRef {
  type: "default" | "first" | "even";
  /** Internal id pointing into `SobreeDocument.rawParts` /
   *  `relationships`. We store the header/footer body itself as a
   *  `Block[]` keyed in a side table at the SobreeDocument level. */
  partId: string;
}

// === styles ===

export interface NamedStyle {
  id: string;
  type: "paragraph" | "character" | "table" | "numbering";
  /** Display name shown in Word's style picker. */
  displayName: string;
  /** Inherits from another style id. */
  basedOn?: string;
  /** The style applied to the next paragraph after this one (for headings). */
  nextStyleId?: string;
  /** Default run properties. */
  runDefaults?: RunProperties;
  /** Default paragraph properties. */
  paragraphDefaults?: ParagraphProperties;
  /** Numbering linked via the style's `<w:numPr>` — the source of heading
   *  outline numbers ("1", "1.1", "1.2"). `numId` references a
   *  `NumberingDefinition`; `level` is the outline level this style sits at.
   *  Distinct from `ParagraphProperties.numbering` (a paragraph's OWN list
   *  membership); a style's numbering applies to every paragraph using it. */
  numbering?: { numId: number; level: number };
  /** Default table properties (only for table styles). */
  tableDefaults?: TableProperties;
  /** Table-style borders + conditional formatting (only for table
   *  styles). Resolved per cell at render time. */
  tableStyle?: TableStyleDefinition;
}

// === numbering ===

export interface NumberingDefinition {
  /** `numId` referenced from `ParagraphProperties.numbering`. */
  numId: number;
  /** The abstract format definition. */
  abstractFormat: AbstractNumberingFormat;
}

export interface AbstractNumberingFormat {
  /** One per indent level (0..8 typically). */
  levels: NumberingLevel[];
}

export interface NumberingLevel {
  level: number;
  /** Format: `bullet`, `decimal`, `lowerRoman`, `upperLetter`, … */
  format: string;
  /** Text template, e.g. `%1.` or a literal bullet character. */
  text: string;
  /** Restart numbering after this level. */
  restart?: number;
  /** Indentation of the numbered text. */
  paragraphIndent?: ParagraphIndent;
  /** Run properties for the bullet/number marker itself. */
  runDefaults?: RunProperties;
}

// === relationships ===

/**
 * Mirror of the `_rels/document.xml.rels` table — Sobree tracks
 * relationships as data so headers, footers, images, hyperlinks all share
 * one allocation strategy at export time.
 */
export interface RelationshipManifest {
  /** Map of `rId…` → relationship descriptor. */
  byId: Record<string, Relationship>;
}

export interface Relationship {
  id: string;
  type: RelationshipType;
  target: string;
  /** External (true) means `target` is a URL; otherwise a part path. */
  external?: boolean;
}

export type RelationshipType =
  | "header"
  | "footer"
  | "image"
  | "hyperlink"
  | "styles"
  | "numbering"
  | "settings"
  | "fontTable"
  | "theme"
  | "comments"
  | "footnotes"
  | "endnotes";
