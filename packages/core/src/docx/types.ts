/**
 * Lightweight OOXML-flavoured types used by the DOCX importer/exporter.
 *
 * These are NOT a general OOXML model — they carry only the fields we
 * actually care about. Anything unknown is dropped (and logged to the
 * warnings channel by the caller).
 */

/** Result of an `importDocx()` call — the SobreeDocument plus any warnings. */
export interface DocxImportResult {
  document: import("../doc/types").SobreeDocument;
  warnings: string[];
}

/** Result of an `exportDocx()` call. */
export interface DocxExportResult {
  blob: Blob;
  bytes: Uint8Array;
  warnings: string[];
}

/** A single inline run's formatting flags — what `<w:rPr>` tells us. */
export interface RunFormat {
  /** `<w:rStyle w:val="…">` — a character style applied to the run. Its
   *  rPr (colour, underline, …) is resolved against the style cascade at
   *  render time, under any direct run formatting. */
  styleId?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** `<w:caps/>` — render the run with `text-transform: uppercase`. */
  caps?: boolean;
  /** CSS-ready `#rrggbb`. */
  color?: string;
  /** Highlight colour name or CSS-ready `#rrggbb`. */
  highlight?: string;
  /** CSS-ready `font-family` value. */
  fontFamily?: string;
  /** Size in pt. */
  fontSizePt?: number;
  verticalAlign?: "subscript" | "superscript";
  /**
   * `<w:rPrChange>` — a snapshot of the run's properties before the
   * most recent tracked format edit. The inner `<w:rPr>` is parsed
   * into the same `RunFormat` shape (recursion-free: the snapshot
   * itself doesn't carry an `revisionFormat`).
   */
  revisionFormat?: {
    before: RunFormat;
    author?: string;
    date?: string;
  };
}

/** Paragraph-level formatting — from `<w:pPr>`. */
export interface ParagraphFormat {
  /** 1..6 if the paragraph carries a `Heading{N}` style; 0 otherwise. */
  headingLevel?: number;
  /** Verbatim `w:pStyle` value (`ListParagraph`, `BodyText`, …). Carries
   *  the cascade anchor for non-heading paragraphs — without it, the
   *  renderer falls back to Normal and any style-defined spacing /
   *  indent / font is lost. */
  styleId?: string;
  alignment?: "left" | "center" | "right" | "justify";
  /** Parsed `w:line` / `w:lineRule` into a CSS `line-height` multiplier. */
  lineHeight?: number;
  /** Explicit `<w:spacing w:after>` in twips. Stored as-is (including
   *  0) so the value overrides cascaded defaults. */
  spacingAfterTwips?: number;
  /** Explicit `<w:spacing w:before>` in twips. */
  spacingBeforeTwips?: number;
  /** Raw numbering reference (`numId`, `ilvl`) if this para is part of a list. */
  numId?: number;
  numLevel?: number;
  /** Paragraph indentation (`<w:ind w:left/right/firstLine/hanging>`). */
  indent?: import("../doc/types").ParagraphIndent;
  /** Custom tab stops from `<w:pPr><w:tabs>` — positions in twips,
   *  alignment ("left" / "center" / "right" / "decimal"), and optional
   *  leader (dots / dashes / etc.). Translated to CSS by the renderer. */
  tabStops?: { positionTwips: number; alignment: string; leader?: string }[];
  /** Font properties of the paragraph mark itself, from
   *  `<w:pPr><w:rPr>`. Used by the renderer to size the paragraph's
   *  line height when there are no inline runs to provide a font. */
  markFormat?: { fontFamily?: string; fontSizePt?: number };
  /** Paragraph background colour (`<w:shd w:fill="…">`). */
  shading?: import("../doc/types").Shading;
  /** Paragraph borders (`<w:pBdr>` — top / bottom / left / right /
   *  between). Used for inline rules like the dotted divider Word
   *  draws beneath the page-header text on complex-multipage.docx. */
  borders?: import("../doc/types").ParagraphProperties["borders"];
  /**
   * Paragraph-mark revision (`<w:pPr><w:rPr><w:ins/></w:rPr></w:pPr>`).
   * Semantically: the paragraph break that *precedes* this paragraph
   * is a tracked change. See `ParagraphProperties.revision` for the
   * accept/reject contract.
   */
  revision?: import("../doc/types").RevisionMark;
}
