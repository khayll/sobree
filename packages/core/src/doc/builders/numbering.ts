/**
 * Numbering / list-definition builders. A list paragraph references a
 * `numId` + level (`paragraph(runs, { numbering: { numId, level } })`); the
 * matching `NumberingDefinition` — built here — lives in
 * `SobreeDocument.numbering` and describes how each level is marked.
 */

import type { NumberingDefinition, NumberingLevel, ParagraphIndent, RunProperties } from "../types";

/** Word's stock list geometry: 0.5" text indent with a 0.25" hanging
 *  marker, stepping 0.5" deeper per level. */
const LEVEL_INDENT_TWIPS = 720;
const HANGING_TWIPS = 360;

export interface NumberingLevelOptions {
  restart?: number;
  paragraphIndent?: ParagraphIndent;
  /** Run properties for the marker glyph/number itself. */
  runDefaults?: RunProperties;
}

/** One indent level of a list. `format` is `bullet` / `decimal` /
 *  `lowerRoman` / `upperLetter` / …; `text` is the marker template
 *  (`%1.`, `(%1)`, or a literal bullet glyph). */
export function numberingLevel(
  level: number,
  format: string,
  text: string,
  options: NumberingLevelOptions = {},
): NumberingLevel {
  return {
    level,
    format,
    text,
    ...(options.restart !== undefined ? { restart: options.restart } : {}),
    ...(options.paragraphIndent !== undefined ? { paragraphIndent: options.paragraphIndent } : {}),
    ...(options.runDefaults !== undefined ? { runDefaults: options.runDefaults } : {}),
  };
}

/** A numbering definition: a `numId` (referenced from paragraphs) plus its
 *  level formats. */
export function numberingDefinition(numId: number, levels: NumberingLevel[]): NumberingDefinition {
  return { numId, abstractFormat: { levels } };
}

/** Default indent for level `n` — text at `(n+1) × 0.5"` with a hanging
 *  marker, matching Word's built-in list styles. */
function levelIndent(level: number): ParagraphIndent {
  return { leftTwips: (level + 1) * LEVEL_INDENT_TWIPS, hangingTwips: HANGING_TWIPS };
}

/** A bullet list of `levels` levels (default 3), cycling • ◦ ▪. */
export function bulletDefinition(numId: number, levels = 3): NumberingDefinition {
  const glyphs = ["•", "◦", "▪"];
  return numberingDefinition(
    numId,
    Array.from({ length: levels }, (_, i) =>
      numberingLevel(i, "bullet", glyphs[i % glyphs.length] ?? "•", {
        paragraphIndent: levelIndent(i),
      }),
    ),
  );
}

/** An ordered list of `levels` levels (default 3), each `%1.` decimal,
 *  restarting at the level above. */
export function orderedDefinition(numId: number, levels = 3): NumberingDefinition {
  return numberingDefinition(
    numId,
    Array.from({ length: levels }, (_, i) =>
      numberingLevel(i, "decimal", `%${i + 1}.`, {
        restart: i,
        paragraphIndent: levelIndent(i),
      }),
    ),
  );
}
