// Top-level block nodes: the `Block` union and its non-table members.

import type { InlineFrame } from "./drawing";
import type { ParagraphProperties } from "./paragraph";
import type { InlineRun } from "./runs";
import type { Table } from "./table";

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
