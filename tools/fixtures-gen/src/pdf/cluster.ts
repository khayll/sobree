/**
 * Cluster raw text items into visual lines.
 *
 * PDF text-content extractors return one item per styled run on the
 * page. Multiple items can share a single visual line (when their
 * font / colour / weight changes mid-line). To compare with Sobree's
 * rendered lines we need one entry per visible row of text.
 *
 * The clustering rule: items within `Y_TOL` pt of each other vertically
 * are on the same line. Items are then sorted top-to-bottom (y desc,
 * since PDF y grows upward) and within each line left-to-right.
 */

import type { LineMetric } from "./types";
import type { RawTextItem } from "./extract";

/** Two items with |Δy| ≤ this many pt are considered on the same line.
 *  Most fonts at 12pt have a baseline jitter under 0.5pt across glyphs;
 *  1pt is a safe upper bound that still separates back-to-back lines
 *  at any typical line-height (≥ ~14pt). */
const Y_TOL = 1;

export function clusterIntoLines(items: RawTextItem[]): LineMetric[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: LineMetric[] = [];
  let current: RawTextItem[] = [];

  for (const item of sorted) {
    if (current.length === 0 || Math.abs(current[0]!.y - item.y) <= Y_TOL) {
      current.push(item);
    } else {
      lines.push(mergeLine(current));
      current = [item];
    }
  }
  if (current.length > 0) lines.push(mergeLine(current));
  return lines;
}

function mergeLine(items: RawTextItem[]): LineMetric {
  const first = items[0]!;
  const text = items.map((i) => i.text).join("").trim();
  const minX = Math.min(...items.map((i) => i.x));
  const maxRight = Math.max(...items.map((i) => i.x + i.width));
  const tallestH = Math.max(...items.map((i) => i.height));
  return {
    text,
    x: round2(minX),
    y: round2(first.y),
    width: round2(maxRight - minX),
    height: round2(tallestH),
    fontName: first.fontName,
    fontSize: first.fontSize,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
