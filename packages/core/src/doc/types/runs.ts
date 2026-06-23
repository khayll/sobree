// Inline run nodes and run-level properties.

import type { Shading } from "../formatting.types";
import type { RevisionMark } from "./revisions";

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
