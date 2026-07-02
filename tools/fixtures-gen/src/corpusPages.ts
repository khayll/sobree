/**
 * CLI: live-paginator corpus gate.
 *
 * The oracle-snapshot gate (`pnpm corpus:check`) compares AST-level
 * imports and never runs the real paginator — page-count and
 * break-position regressions are invisible to it. This gate renders
 * every corpus fixture in a headless Chromium through the playground
 * (the REAL paginator) and compares page counts + per-page text
 * placement against the LibreOffice reference (`libreoffice/
 * metrics.json`), gated by a committed baseline with tolerances.
 *
 *   pnpm corpus:pages            — check vs committed baseline,
 *                                  exit non-zero on regression
 *   pnpm corpus:pages:baseline   — write current scores as the new
 *                                  baseline (after intentional
 *                                  paginator changes; commit result)
 *
 * Filter to a single doc by passing its slug:
 *   pnpm corpus:pages jellap
 *
 * Requires Playwright's Chromium:
 *   pnpm --filter @sobree/fixtures-gen exec playwright install chromium
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type CorpusEntry, discoverCorpus, relPath } from "./corpus/discover";
import {
  type PagesRegression,
  type PagesScore,
  comparePagesToBaseline,
  scorePages,
} from "./corpus/pagesScore";
import { type RunFixture, withPlaygroundBrowser } from "./corpus/playgroundBrowser";
import type { FixtureMetrics } from "./pdf/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

type Mode = "check" | "baseline";

interface ScoredEntry {
  entry: CorpusEntry;
  score: PagesScore;
  regressions: PagesRegression[];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const mode = (argv[0] ?? "check") as Mode;
  const filterSlug = argv.slice(1).find((a) => !a.startsWith("-"));

  const entries = discoverCorpus({ repoRoot: REPO_ROOT, filterSlug }).filter((e) => {
    if (existsSync(metricsPath(e))) return true;
    process.stderr.write(
      `skip ${e.slug} — missing ${relPath(metricsPath(e), REPO_ROOT)} (run \`pnpm corpus:render\` first)\n`,
    );
    return false;
  });
  if (entries.length === 0) {
    process.stderr.write("no corpus entries with a libreoffice reference found\n");
    process.exit(1);
  }
  process.stdout.write(
    `corpus:pages — ${entries.length} ${entries.length === 1 ? "entry" : "entries"} through the live paginator\n`,
  );

  const { scored, failures } = await withPlaygroundBrowser(REPO_ROOT, (run) =>
    scoreAll(entries, run),
  );

  printResults(scored, mode);

  if (mode === "baseline") {
    for (const r of scored) writeBaseline(r.entry, r.score);
    process.stdout.write(
      `\npages baseline updated for ${scored.length} entries — review and commit\n`,
    );
  } else {
    const regressed = scored.filter((r) => r.regressions.length > 0);
    if (regressed.length > 0) {
      process.stderr.write(
        `\n${regressed.length} ${regressed.length === 1 ? "entry" : "entries"} regressed:\n`,
      );
      for (const r of regressed) {
        process.stderr.write(`\n  ${r.entry.slug}\n`);
        for (const reg of r.regressions) {
          process.stderr.write(
            `    ${reg.metric}: baseline=${fmt(reg.baseline)} → current=${fmt(reg.current)} (Δ ${fmt(reg.delta)}, tolerance ${fmt(reg.tolerance)})\n`,
          );
        }
      }
    } else if (failures.length === 0) {
      process.stdout.write("\nall corpus entries within pages baseline tolerance\n");
    }
    if (failures.length > 0 || regressed.length > 0) process.exit(1);
  }

  if (failures.length > 0) process.exit(1);
}

async function scoreAll(
  entries: CorpusEntry[],
  runFixture: RunFixture,
): Promise<{ scored: ScoredEntry[]; failures: string[] }> {
  const scored: ScoredEntry[] = [];
  const failures: string[] = [];
  for (const entry of entries) {
    process.stdout.write(`  paginate ${entry.slug} ... `);
    // One retry: a first load occasionally straddles a slow font decode
    // and times out without settling; a clean second load is reliable.
    let result = await runFixture(entry.slug);
    if (!("error" in result) && !result.settled) result = await runFixture(entry.slug);
    if ("error" in result) {
      process.stdout.write(`FAIL (${result.error})\n`);
      failures.push(`${entry.slug}: ${result.error}`);
      continue;
    }
    if (!result.settled) {
      process.stdout.write("FAIL (pagination never settled — not scoring garbage counts)\n");
      failures.push(`${entry.slug}: pagination did not settle within timeout`);
      continue;
    }
    const metrics = JSON.parse(readFileSync(metricsPath(entry), "utf8")) as FixtureMetrics;
    const { score } = scorePages(metrics.pages, result.pageTexts);
    scored.push({
      entry,
      score,
      regressions: comparePagesToBaseline(score, readBaseline(entry)),
    });
    process.stdout.write(
      `${score.sobreePages}p vs lo ${score.libreofficePages}p, overlap=${fmt(score.pageTextOverlap)}\n`,
    );
  }
  return { scored, failures };
}

function printResults(results: ScoredEntry[], mode: Mode): void {
  const lines = results.map((r) => {
    const baseline = readBaseline(r.entry);
    const flag = mode === "check" && r.regressions.length > 0 ? "✗" : baseline === null ? "·" : "✓";
    const pages = `${r.score.sobreePages}p/${r.score.libreofficePages}p`;
    return `  ${flag} ${r.entry.slug.padEnd(40)} pages=${pages.padStart(7)} overlap=${fmt(r.score.pageTextOverlap).padStart(6)}`;
  });
  process.stdout.write(`\n${lines.join("\n")}\n`);
}

function fmt(n: number | null): string {
  if (n === null) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

function metricsPath(entry: CorpusEntry): string {
  return join(entry.libreofficeDir, "metrics.json");
}

function baselinePath(entry: CorpusEntry): string {
  return join(entry.baselineDir, "pages.json");
}

function readBaseline(entry: CorpusEntry): PagesScore | null {
  if (!existsSync(baselinePath(entry))) return null;
  try {
    return JSON.parse(readFileSync(baselinePath(entry), "utf8")) as PagesScore;
  } catch {
    return null;
  }
}

function writeBaseline(entry: CorpusEntry, score: PagesScore): void {
  mkdirSync(entry.baselineDir, { recursive: true });
  writeFileSync(baselinePath(entry), `${JSON.stringify(score, null, 2)}\n`, "utf8");
}

main().catch((err) => {
  process.stderr.write(
    `corpus:pages failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
