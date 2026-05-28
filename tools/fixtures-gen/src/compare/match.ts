/**
 * Match Sobree snapshot blocks to LibreOffice PDF lines by text.
 *
 * The snapshot's per-block text is truncated to 60 chars with an
 * ellipsis (`…`); the PDF's per-line text is the raw glyph string
 * for that wrapped row. Matching strategy:
 *
 *   1. Walk PDF lines in document order (page-by-page). For each
 *      snapshot block, try a **prefix** match against the cursor
 *      (and later lines), greedily consuming until the block's
 *      prefix is covered. Cursor advances past consumed lines so the
 *      next block starts where this one left off.
 *
 *   2. If no prefix match is found, try a **substring** match within
 *      a small window of lines near the cursor. This catches the
 *      table-row case: several `<td>` cells render into one visual
 *      line in the PDF (same Y, different X) and only the *first*
 *      cell's text appears at the start of the concatenated line —
 *      the other cells live mid-string. We record the matched line
 *      and do NOT advance the cursor, so subsequent cells of the
 *      same row can also match the same line.
 *
 * Truncated snapshot text (ending in `…`) opportunistically consumes
 * additional PDF lines until the *next* block's prefix appears,
 * gluing wrapped continuations to the right block.
 */

import type { LineMetric } from "../pdf/types";
import type { SnapshotBlock } from "./snapshot";

export interface MatchResult {
  block: SnapshotBlock;
  /** Consecutive PDF lines assigned to this block. May be empty. */
  pdfLines: LineMetric[];
  /**
   * How the block was matched against `pdfLines`:
   *   - "prefix": block text appears at the START of the first line.
   *               Cursor advanced past the matched lines.
   *   - "substring": block text appears MID-line (typically table
   *               cells sharing a row's Y). Cursor NOT advanced —
   *               sibling cells can match the same line.
   *   - "none": block text didn't match anything in the search window.
   */
  matchType: "prefix" | "substring" | "none";
}

const ELLIPSIS = "…";
/** Lookahead window for substring matching: how many PDF lines past
 *  the cursor to scan for a mid-line occurrence. Small enough that
 *  later-document blocks don't accidentally match early lines, large
 *  enough to cover a few-cell table row that all renders at one Y. */
const SUBSTRING_LOOKAHEAD = 5;

export function matchBlocksToLines(
  blocks: SnapshotBlock[],
  flatLines: LineMetric[],
): MatchResult[] {
  const results: MatchResult[] = [];
  let cursor = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const prefix = normalize(stripEllipsis(block.text));
    if (prefix.length === 0) {
      results.push({ block, pdfLines: [], matchType: "none" });
      continue;
    }

    // Try prefix match first — the common case for paragraphs and the
    // first cell of every table row.
    const startProbe = prefix.slice(0, Math.min(20, prefix.length));
    let start = cursor;
    while (
      start < flatLines.length &&
      !stripLeadingMarker(normalize(flatLines[start]!.text)).startsWith(startProbe)
    ) {
      start++;
    }

    if (start < flatLines.length) {
      // Prefix match found — greedily consume lines until concatenation covers `prefix`.
      const lines: LineMetric[] = [];
      let concat = "";
      let j = start;
      while (j < flatLines.length && concat.length < prefix.length) {
        const lineText = normalize(flatLines[j]!.text);
        concat = concat.length === 0 ? lineText : `${concat} ${lineText}`;
        lines.push(flatLines[j]!);
        j++;
      }

      if (block.text.endsWith(ELLIPSIS)) {
        const next = blocks[i + 1];
        const nextProbe = next
          ? normalize(stripEllipsis(next.text)).slice(0, 20)
          : null;
        while (j < flatLines.length && lines.length < 16) {
          const lineText = stripLeadingMarker(normalize(flatLines[j]!.text));
          if (nextProbe && lineText.startsWith(nextProbe)) break;
          if (!nextProbe) break;
          lines.push(flatLines[j]!);
          j++;
        }
      }

      cursor = j;
      results.push({ block, pdfLines: lines, matchType: "prefix" });
      continue;
    }

    // Prefix match failed — try substring match within a small window
    // *around* the cursor (look both backward and forward). Backward
    // catches the table-row case: every cell of a row clusters into one
    // PDF line; the FIRST cell prefix-matches and advances the cursor,
    // so when we get to the 2nd / 3rd / 4th cell of the same row, the
    // line is already behind the cursor. Forward catches blocks that
    // skipped a few lines in the PDF order. Do NOT advance the cursor
    // — siblings need to keep matching against the same line.
    const subProbe = startProbe;
    const windowStart = Math.max(0, cursor - SUBSTRING_LOOKAHEAD);
    const windowEnd = Math.min(flatLines.length, cursor + SUBSTRING_LOOKAHEAD);
    let subMatch: LineMetric | null = null;
    for (let k = windowStart; k < windowEnd; k++) {
      const lineText = normalize(flatLines[k]!.text);
      if (lineText.includes(subProbe)) {
        subMatch = flatLines[k]!;
        break;
      }
    }
    if (subMatch) {
      results.push({ block, pdfLines: [subMatch], matchType: "substring" });
    } else {
      results.push({ block, pdfLines: [], matchType: "none" });
    }
  }

  return results;
}

/** Flatten all pages' lines into a single array, preserving order. */
export function flattenLines(
  pages: Array<{ page: number; lines: LineMetric[] }>,
): LineMetric[] {
  return pages.flatMap((p) => p.lines);
}

function stripEllipsis(text: string): string {
  return text.endsWith(ELLIPSIS) ? text.slice(0, -1) : text;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Strip common leading list / numbering markers that PDF renders
 * inline but Sobree's snapshot text (which comes from `textContent`
 * of the LI) omits because the marker is the LI's pseudo-element.
 *
 * Patterns covered (Hungarian + English):
 *   - "1.", "1)", "(1)", "i.", "iv)", "a.", "A)"
 *   - "•", "◦", "▪", "■", "–", "—"
 *   - Trailing whitespace after the marker.
 */
function stripLeadingMarker(text: string): string {
  return text
    .replace(/^\s*(?:[•◦▪■\-–—]|(?:\(?[ivxlcdmIVXLCDM]+\)|[ivxlcdmIVXLCDM]+\.)|(?:\(?[A-Za-z]\)|[A-Za-z]\.)|(?:\(?\d+\)|\d+\.))\s+/u, "")
    .trim();
}
