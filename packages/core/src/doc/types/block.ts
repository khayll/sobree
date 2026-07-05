// The recursive block tree: the `Block` union and every kind that nests
// blocks. Tables (cell content) and inline frames (textbox bodies) are
// mutually recursive with `Block`, so they live here rather than in
// separate files — splitting them would force a type-import cycle
// (`Block` names them; they name `Block`). The floating anchored-frame
// layer, which only depends on `Block` one-way, stays in `./drawing`.

import type {
  Shading,
  TableBorders,
  TableCellBorders,
  TableCellMargins,
} from "../formatting.types";
import type { TableLook, TableStyleDefinition } from "../tableStyle.types";
import type { ParagraphAlignment, ParagraphProperties } from "./paragraph";
import type { InlineRun } from "./runs";

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
  /** `<w:tblW w:type="pct">` — table width as a PERCENTAGE of the text
   *  column (stored unit: fiftieths of a percent; kept here as the
   *  resolved percentage, e.g. `103.3`). Banner tables deliberately
   *  exceed 100% so they reach past the margins to meet a page-frame
   *  decoration. Mutually exclusive with `widthTwips`. */
  widthPct?: number;
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
  /** `<w:trHeight w:val>` in twips. Meaning depends on `heightRule`. */
  heightTwips?: number;
  /** `<w:trHeight w:hRule>`: `atLeast` (default when trHeight present)
   *  = the row grows with content but never shrinks below the value;
   *  `exact` = the row is EXACTLY this tall, content clips. Banner
   *  tables size their name row this way (0.5in row, text centred). */
  heightRule?: "atLeast" | "exact";
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
  /** `<a:spAutoFit/>` in `<wps:bodyPr>`: the shape's HEIGHT tracks its
   *  text — the stored extent is only the last-saved size, and Word/LO
   *  re-fit on layout. The renderer sizes such a box by its content
   *  instead of pinning the stale extent (ljmu letterhead's footer
   *  address box saved 36.9mm tall for ~20mm of text; pinning pushed
   *  the text ~13mm above where Word renders it). */
  autoFit?: boolean;
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
