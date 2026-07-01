// Paragraph-level properties and their sub-shapes.

import type { BorderSpec, Shading } from "../formatting.types";
import type { RevisionMark } from "./revisions";
import type { RunProperties } from "./runs";

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
  /**
   * `<w:contextualSpacing/>` (ECMA-376 §17.3.1.9) — omit this
   * paragraph's before/after spacing when the adjacent paragraph uses
   * the SAME paragraph style. Word/LibreOffice collapse the inter-
   * paragraph gap to zero between consecutive same-style paragraphs
   * (the classic case: double-spaced thesis body, or tight bulleted
   * lists). The renderer suppresses the corresponding margin only when
   * the neighbour shares this paragraph's style — see
   * `applyParagraphProps`.
   */
  contextualSpacing?: boolean;
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
