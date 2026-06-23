// Floating drawing layer: anchored frames positioned at explicit
// coordinates. These depend on `Block` (textbox bodies) one-way — the
// inline-frame kind, which `Block` names back, lives in `./block` to keep
// this module acyclic.

import type { Block } from "./block";

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
