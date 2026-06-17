/**
 * Block-level builders — the things that sit directly in a document body
 * (or a table cell): paragraphs, headings, and section breaks.
 */

import type { InlineRun, Paragraph, ParagraphProperties, SectionBreak } from "../types";

/** A paragraph with the given runs and properties (both optional). */
export function paragraph(runs: InlineRun[] = [], properties: ParagraphProperties = {}): Paragraph {
  return { kind: "paragraph", properties, runs };
}

/** Heading paragraph (`Heading{level}` style, level clamped to 1..6). */
export function heading(
  level: number,
  runs: InlineRun[] = [],
  properties: ParagraphProperties = {},
): Paragraph {
  const lv = Math.max(1, Math.min(6, level));
  return paragraph(runs, { ...properties, styleId: `Heading${lv}` });
}

/** A section break that switches to `toSectionIndex` in the document's
 *  `sections` array for the content that follows. */
export function sectionBreak(toSectionIndex: number): SectionBreak {
  return { kind: "section_break", toSectionIndex };
}
