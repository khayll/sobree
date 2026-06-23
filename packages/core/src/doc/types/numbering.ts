// List / numbering definitions referenced by paragraphs and styles.

import type { ParagraphIndent } from "./paragraph";
import type { RunProperties } from "./runs";

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
