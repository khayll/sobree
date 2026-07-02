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
 *
 * PHASE 2 — column-tolerant recovery. The linear cursor above assumes
 * Sobree's block order matches the PDF's line order. That holds for
 * single-column flow, but a multi-column section breaks it: LibreOffice
 * extracts the two columns *interleaved by baseline-Y* (and even fuses
 * a left+right line that share a Y into one glyph string), while Sobree
 * emits clean logical reading order — all of column 1, then column 2.
 * The cursor desyncs the moment it enters the column band and strands
 * the whole second column as "none". After the linear pass, a second
 * pass re-examines each still-unmatched block with a LOOSE,
 * bidirectional search over a bounded window: alphanumeric-only
 * comparison (so curly-quote spacing and glued glyphs don't defeat it)
 * and substring matches that may reuse a fused line. This only ever
 * upgrades "none" → "substring"; phase-1 matches and their line groups
 * (which the drift metric measures) are untouched.
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
/**
 * How far forward the prefix scan may reach for a block's first line.
 * A block should match the NEAREST forward occurrence of its text, not
 * a coincidental hit anywhere in the document. Without this bound the
 * scan ran to end-of-document, so on a long report a block could match
 * a stray later line, jump the cursor near the end, and strand every
 * subsequent block as "none" — the cursor never recovered. Measured to
 * dominate the unbounded scan: every corpus fixture matches at least as
 * many blocks as before, and the desync'd long reports leap (31-page
 * report 85 → 360 matched blocks; short docs, already matching within a
 * couple of pages, unchanged). ~2-3 pages of lines — wide enough to
 * cover a two-column article's reading-order gaps (40 was too tight
 * there) and a table row's other cells, narrow enough that a
 * coincidental later-section line can't latch the cursor.
 */
const PREFIX_SCAN_WINDOW = 60;

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
    // first cell of every table row. Bounded to PREFIX_SCAN_WINDOW so a
    // missing block can't latch onto a coincidental far-ahead line and
    // desync the cursor for the rest of the document.
    const startProbe = prefix.slice(0, Math.min(20, prefix.length));
    const scanLimit = Math.min(flatLines.length, cursor + PREFIX_SCAN_WINDOW);
    let start = cursor;
    while (
      start < scanLimit &&
      !stripLeadingMarker(normalize(flatLines[start]!.text)).startsWith(startProbe)
    ) {
      start++;
    }

    if (start < scanLimit) {
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
        const nextProbe = next ? normalize(stripEllipsis(next.text)).slice(0, 20) : null;
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

  recoverColumnInterleave(results, flatLines);
  return results;
}

/** How far the column-tolerant recovery pass looks on either side of a
 *  block's reading-order anchor. Wide enough to span a two-column band's
 *  interleave (a page of lines), bounded so a coincidental match in a far
 *  section can't be latched (mirrors `PREFIX_SCAN_WINDOW`). */
const RECOVERY_WINDOW = 60;

/**
 * Phase 2: upgrade still-"none" blocks to "substring" when their text is
 * present in the PDF but out of linear reading order (the multi-column
 * case). Walks `results` in order, tracking a soft anchor = the latest
 * matched line index seen so far; each unmatched block is searched
 * bidirectionally from that anchor with loose, alphanumeric-only
 * comparison. Mutates `results` in place. Non-consuming: a fused
 * left+right line may satisfy several blocks.
 */
function recoverColumnInterleave(results: MatchResult[], flatLines: LineMetric[]): void {
  const lineIndex = new Map<LineMetric, number>();
  flatLines.forEach((l, i) => lineIndex.set(l, i));
  const loose = flatLines.map((l) => looseNormalize(l.text));

  let anchor = 0;
  for (const r of results) {
    if (r.matchType !== "none") {
      const idx = r.pdfLines.length > 0 ? lineIndex.get(r.pdfLines[0]!) : undefined;
      if (idx !== undefined) anchor = Math.max(anchor, idx);
      continue;
    }
    const text = looseNormalize(stripEllipsis(r.block.text));
    if (text.length === 0) continue; // empty / punctuation-only — nothing to match
    const probe = text.slice(0, Math.min(24, text.length));
    const lo = Math.max(0, anchor - RECOVERY_WINDOW);
    const hi = Math.min(flatLines.length, anchor + RECOVERY_WINDOW);
    let hit = -1;
    // Search outward from the anchor (forward first, then the mirrored
    // backward line) so the nearest occurrence wins. `d` reaches the
    // farther of the two window edges (forward `hi-1-anchor`, backward
    // `anchor-lo`).
    const maxStep = Math.max(hi - 1 - anchor, anchor - lo);
    for (let d = 0; d <= maxStep && hit < 0; d++) {
      for (const k of [anchor + d, anchor - d]) {
        if (k < lo || k >= hi) continue;
        const lt = loose[k]!;
        // `lt.startsWith(probe)`: block begins this line.
        // `probe.startsWith(lt)`: line is a (wrapped) head of the block.
        // `lt.includes(probe)`: block text sits mid-line (a fused column).
        if (
          lt.startsWith(probe) ||
          (lt.length >= 10 && probe.startsWith(lt)) ||
          lt.includes(probe)
        ) {
          hit = k;
          break;
        }
      }
    }
    if (hit >= 0) {
      r.pdfLines = [flatLines[hit]!];
      r.matchType = "substring";
    }
  }
}

/** Lowercase + collapse every non-alphanumeric run to a single space.
 *  Erases list markers, curly-quote spacing, and glyph-gluing artifacts
 *  of PDF extraction, reducing matching to "is this text present". */
function looseNormalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Flatten all pages' lines into a single array, preserving order. */
export function flattenLines(pages: Array<{ page: number; lines: LineMetric[] }>): LineMetric[] {
  return pages.flatMap((p) => p.lines);
}

function stripEllipsis(text: string): string {
  return text.endsWith(ELLIPSIS) ? text.slice(0, -1) : text;
}

function normalize(text: string): string {
  // Tab-leader fills are DECORATION, not text: LO's PDF extraction
  // renders a TOC line's dot leader as literal ASCII periods
  // ("ACKNOWLEDGMENT......iii") while Sobree's document text carries
  // the tab character ("ACKNOWLEDGMENT\tiii"). Collapse ASCII-dot runs
  // (4+ so real prose "..." survives) to a space so both sides compare
  // on the semantic content — entry text and page number. U+2026
  // ellipsis runs are NOT collapsed: templates use them as real text
  // (google-modern's "…………" placeholder rules).
  return text
    .replace(/\.{4,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
    .replace(
      /^\s*(?:[•◦▪■\-–—]|(?:\(?[ivxlcdmIVXLCDM]+\)|[ivxlcdmIVXLCDM]+\.)|(?:\(?[A-Za-z]\)|[A-Za-z]\.)|(?:\(?\d+\)|\d+\.))\s+/u,
      "",
    )
    .trim();
}
