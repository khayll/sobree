/**
 * Per-page allocation summary from LibreOffice metrics.
 *
 * For each page in the PDF, capture:
 *   - line count
 *   - top/bottom Y in PDF user-space (and the equivalent "from-top"
 *     distance in pt — easier to reason about than PDF's bottom-origin)
 *   - first / last visual line text
 *   - vertical span used (`topY - bottomY` ≈ printed body height)
 *
 * The intent is to give a side-by-side comparison target: once Sobree
 * paginates the same doc, we can compare which text lands on which
 * page and whether the vertical span used per page matches.
 */

import type { FixtureMetrics } from "../pdf/types";

export interface PageAllocation {
  page: number;
  lineCount: number;
  /** Topmost line's `y` (PDF coord — larger = higher). */
  topY: number;
  /** Bottommost line's `y`. */
  bottomY: number;
  /** Vertical span used by content (`topY - bottomY`, in pt). */
  spanPt: number;
  /** Distance from page top (`pageHeightPt - topY`, in pt). */
  topMarginPt: number;
  /** Distance from page bottom (`bottomY`, since PDF origin = bottom-left). */
  bottomMarginPt: number;
  firstText: string;
  lastText: string;
}

export interface PageAllocations {
  fixture: string;
  pageHeightPt: number;
  pages: PageAllocation[];
}

export function summarisePages(metrics: FixtureMetrics): PageAllocations {
  const pageHeightPt = metrics.pdfSizePt.height;
  const pages = metrics.pages.map((p): PageAllocation => {
    if (p.lines.length === 0) {
      return {
        page: p.page,
        lineCount: 0,
        topY: 0,
        bottomY: 0,
        spanPt: 0,
        topMarginPt: pageHeightPt,
        bottomMarginPt: 0,
        firstText: "",
        lastText: "",
      };
    }
    // Pages already arrive sorted top-to-bottom by extract.ts → cluster.ts
    // (Y desc). Reading first/last is enough.
    const first = p.lines[0]!;
    const last = p.lines[p.lines.length - 1]!;
    return {
      page: p.page,
      lineCount: p.lines.length,
      topY: round2(first.y),
      bottomY: round2(last.y),
      spanPt: round2(first.y - last.y),
      topMarginPt: round2(pageHeightPt - first.y),
      bottomMarginPt: round2(last.y),
      firstText: truncate(first.text),
      lastText: truncate(last.text),
    };
  });
  return { fixture: metrics.fixture, pageHeightPt: round2(pageHeightPt), pages };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function truncate(s: string, n = 60): string {
  const cleaned = s.replace(/\s+/g, " ").trim();
  return cleaned.length > n ? `${cleaned.slice(0, n)}…` : cleaned;
}
