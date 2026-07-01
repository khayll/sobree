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
