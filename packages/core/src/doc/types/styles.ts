// Named styles — the paragraph / run / table cascade definitions.

import type { TableStyleDefinition } from "../tableStyle.types";
import type { TableProperties } from "./block";
import type { ParagraphProperties } from "./paragraph";
import type { RunProperties } from "./runs";

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
