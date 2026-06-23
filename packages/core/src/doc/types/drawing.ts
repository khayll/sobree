// Floating + inline drawing layer: anchored frames and inline frames.

import type { Block } from "./block";
import type { ParagraphProperties } from "./paragraph";

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

// === inline frames ===

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
