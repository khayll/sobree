/**
 * Pretty-printer for `FixtureDrift` reports — one summary line per
 * fixture and an indented block-level table when `--verbose` is on.
 */

import type { PageAllocations } from "./pages";
import type { BlockDrift, FixtureDrift } from "./types";

export function formatFixtureSummary(drift: FixtureDrift): string {
  const mean = drift.meanAbsDrift;
  const meanStr = mean === null ? "  n/a" : `${mean >= 0 ? " " : ""}${mean.toFixed(3)}`;
  return `${drift.fixture.padEnd(38)} ${pad(drift.matchedBlocks, 3)}/${pad(drift.textBlockCount, 3)} matched · ${pad(drift.multiLineBlocks, 3)} multiline · mean |Δlh| ${meanStr}`;
}

export function formatFixtureVerbose(drift: FixtureDrift): string {
  const header =
    `\n=== ${drift.fixture} ===\n` +
    `  blocks: ${drift.blockCount} (${drift.textBlockCount} text), matched: ${drift.matchedBlocks}, multi-line: ${drift.multiLineBlocks}, mean |Δlh|: ${drift.meanAbsDrift?.toFixed(4) ?? "n/a"}\n`;
  const tableHeader =
    "  idx tag      lines  fontPt   declLH   effLH    drift    text\n" +
    "  --- ---      -----  ------   ------   -----    -----    ----";
  const rows = drift.blocks.map(formatBlockRow).join("\n");
  const warnings =
    drift.warnings.length > 0
      ? `\n  warnings:\n${drift.warnings.map((w) => `    - ${w}`).join("\n")}`
      : "";
  return `${header}${tableHeader}\n${rows}${warnings}`;
}

function formatBlockRow(b: BlockDrift): string {
  const lh =
    typeof b.declaredLineHeight === "number"
      ? b.declaredLineHeight.toFixed(3)
      : (b.declaredLineHeight ?? "—");
  const eff = b.pdfEffectiveLineHeight?.toFixed(3) ?? "—";
  const drift =
    b.lineHeightDrift !== null
      ? (b.lineHeightDrift >= 0 ? "+" : "") + b.lineHeightDrift.toFixed(3)
      : "—";
  const fontPt = b.declaredFontSizePt?.toFixed(1) ?? "—";
  const text = truncate(b.text, 36);
  return `  ${pad(b.index, 3)} ${b.tag.padEnd(8)} ${pad(b.matchedLineCount, 5)}  ${pad(fontPt, 6)}   ${pad(lh, 6)}   ${pad(eff, 5)}    ${pad(drift, 5)}    ${text}`;
}

export function formatPageAllocations(alloc: PageAllocations): string {
  const header = `\n--- pages: ${alloc.fixture} (page height ${alloc.pageHeightPt}pt) ---\n  page  lines   topMargin  bottomMargin  span     first / last text\n  ----  -----   ---------  ------------  ----     -----------------`;
  const rows = alloc.pages
    .map(
      (p) =>
        `  ${pad(p.page, 4)}  ${pad(p.lineCount, 5)}   ${pad(p.topMarginPt.toFixed(1), 9)}  ${pad(p.bottomMarginPt.toFixed(1), 12)}  ${pad(p.spanPt.toFixed(1), 6)}   ${p.firstText}\n` +
        `                                                       ↳ ${p.lastText}`,
    )
    .join("\n");
  return `${header}\n${rows}`;
}

function pad(n: number | string, width: number): string {
  return String(n).padStart(width);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
