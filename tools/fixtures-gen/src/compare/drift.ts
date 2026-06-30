/**
 * Build a per-fixture `FixtureDrift` from matched (block, lines) pairs.
 *
 * The interesting number is `lineHeightDrift`: the difference between
 * what Sobree declared in CSS and what LibreOffice actually produced.
 * For a block to have a computable drift, we need:
 *
 *   - >= 2 matched PDF lines on the block (so we can measure Δy)
 *   - A numeric `font-size` declared in the snapshot
 *   - A numeric `line-height` declared in the snapshot
 *
 * Blocks failing any of these still appear in the report (so the user
 * can see *why* they're missing), but contribute null drift values.
 */

import type { MatchResult } from "./match";
import type { SnapshotBlock } from "./snapshot";
import type { BlockDrift, FixtureDrift } from "./types";

export function buildDrift(fixture: string, matches: MatchResult[]): FixtureDrift {
  const warnings: string[] = [];
  const blocks: BlockDrift[] = matches.map((m) => buildBlockDrift(m, warnings));

  const multiLine = blocks.filter((b) => b.pdfDeltaY !== null);
  const driftsAbs = blocks
    .map((b) => b.lineHeightDrift)
    .filter((d): d is number => d !== null)
    .map(Math.abs);
  const meanAbsDrift =
    driftsAbs.length > 0 ? driftsAbs.reduce((sum, n) => sum + n, 0) / driftsAbs.length : null;

  return {
    fixture,
    blockCount: blocks.length,
    textBlockCount: matches.filter((m) => hasContent(m.block)).length,
    matchedBlocks: matches.filter((m) => m.pdfLines.length > 0 && hasContent(m.block)).length,
    multiLineBlocks: multiLine.length,
    meanAbsDrift,
    blocks,
    warnings,
  };
}

/** A block carries real document content — not a section-break
 *  separator (editor chrome), not a blank spacer paragraph. Used for
 *  BOTH the matched-ratio numerator and denominator so the ratio can
 *  never exceed 1 (a matched block is, by definition, content). */
function hasContent(block: SnapshotBlock): boolean {
  return !block.isChrome && /\S/.test(block.text);
}

function buildBlockDrift(match: MatchResult, warnings: string[]): BlockDrift {
  const { block, pdfLines } = match;
  const matchedLineCount = pdfLines.length;
  const pdfDeltaY = medianAdjacentDeltaY(pdfLines);
  const declaredFontSizePt = block.fontSizePt;
  const declaredLineHeight = block.lineHeight;

  let pdfEffectiveLineHeight: number | null = null;
  let lineHeightDrift: number | null = null;
  if (pdfDeltaY !== null && declaredFontSizePt !== null && declaredFontSizePt > 0) {
    pdfEffectiveLineHeight = pdfDeltaY / declaredFontSizePt;
    if (typeof declaredLineHeight === "number") {
      lineHeightDrift = declaredLineHeight - pdfEffectiveLineHeight;
    }
  }

  if (matchedLineCount === 0 && block.text.length > 0) {
    warnings.push(
      `block[${block.index}] (${block.tag}) "${truncate(block.text)}" did not match any PDF line`,
    );
  }

  return {
    index: block.index,
    tag: block.tag,
    text: block.text,
    declaredFontSizePt,
    declaredLineHeight,
    matchedLineCount,
    pdfDeltaY,
    pdfEffectiveLineHeight,
    lineHeightDrift,
    pdfFirstLineText: pdfLines[0]?.text ?? null,
  };
}

/**
 * Median of |Δy| between consecutive lines. Median (not mean) so a
 * single outlier — say a hanging indent caused by an image or a
 * tabstop — doesn't skew the leading measurement.
 */
function medianAdjacentDeltaY(lines: { y: number }[]): number | null {
  if (lines.length < 2) return null;
  const deltas: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    deltas.push(Math.abs(lines[i - 1]!.y - lines[i]!.y));
  }
  deltas.sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  return deltas.length % 2 === 0 ? (deltas[mid - 1]! + deltas[mid]!) / 2 : deltas[mid]!;
}

function truncate(s: string, n = 40): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
