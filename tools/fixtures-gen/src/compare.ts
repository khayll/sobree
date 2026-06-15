/**
 * CLI: compare Sobree's rendered styles against LibreOffice's actual
 * line metrics for every fixture, producing per-fixture drift reports.
 *
 * For each fixture `name.docx` we need:
 *   - `name.libreoffice.json`  (ground-truth line metrics; from `extract`)
 *   - `name.snapshot.json`     (Sobree's declared inline styles; from oracle test)
 *
 * Output:
 *   - `name.drift.json` next to each fixture (machine-readable)
 *   - Console: one summary line per fixture, sorted by mean |drift|.
 *
 * Use `--verbose` (or `-v`) to print the per-block table for every
 * fixture; otherwise only summary lines print.
 */

import { existsSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readFileSync } from "node:fs";
import { buildDrift } from "./compare/drift";
import { flattenLines, matchBlocksToLines } from "./compare/match";
import { summarisePages } from "./compare/pages";
import {
  formatFixtureSummary,
  formatFixtureVerbose,
  formatPageAllocations,
} from "./compare/report";
import { loadSnapshot } from "./compare/snapshot";
import type { FixtureMetrics } from "./pdf/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(
  HERE,
  "..",
  "..",
  "..",
  "packages",
  "core",
  "src",
  "docx",
  "import",
  "fixtures",
);

async function main(): Promise<void> {
  const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
  const pagesOnly = process.argv.includes("--pages");
  const fixtureFilter = process.argv.find((a) => a.endsWith(".docx"));

  const entries = await readdir(FIXTURES_DIR);
  const docxFiles = entries
    .filter((f) => f.endsWith(".docx") && !f.startsWith("~$"))
    .filter((f) => !fixtureFilter || f === fixtureFilter)
    .sort();

  const drifts = [];
  const pageReports = [];
  for (const fileName of docxFiles) {
    const base = fileName.replace(/\.docx$/i, "");
    const libreoffPath = join(FIXTURES_DIR, `${base}.libreoffice.json`);
    const snapshotPath = join(FIXTURES_DIR, `${base}.snapshot.json`);
    if (!existsSync(libreoffPath)) {
      process.stderr.write(`skip ${fileName} — missing libreoffice.json\n`);
      continue;
    }
    const metrics = JSON.parse(readFileSync(libreoffPath, "utf8")) as FixtureMetrics;

    // Per-page allocation lives independently of the snapshot — we can
    // emit it even when the oracle snapshot hasn't been generated yet.
    const allocation = summarisePages(metrics);
    pageReports.push(allocation);
    writeFileSync(
      join(FIXTURES_DIR, `${base}.pages.json`),
      `${JSON.stringify(allocation, null, 2)}\n`,
      "utf8",
    );

    if (!existsSync(snapshotPath)) {
      if (!pagesOnly) {
        process.stderr.write(`skip ${fileName} drift — missing snapshot.json\n`);
      }
      continue;
    }

    const blocks = loadSnapshot(snapshotPath);
    const flatLines = flattenLines(metrics.pages);
    const matches = matchBlocksToLines(blocks, flatLines);
    const drift = buildDrift(fileName, matches);
    drifts.push(drift);
    writeFileSync(
      join(FIXTURES_DIR, `${base}.drift.json`),
      `${JSON.stringify(drift, null, 2)}\n`,
      "utf8",
    );
  }

  if (pagesOnly) {
    for (const a of pageReports) process.stdout.write(`${formatPageAllocations(a)}\n`);
    return;
  }

  // Sort: highest mean drift first → calibration priorities surface at top.
  drifts.sort((a, b) => (b.meanAbsDrift ?? -1) - (a.meanAbsDrift ?? -1));

  process.stdout.write("\nDrift summary (sorted by mean |line-height drift|):\n\n");
  for (const d of drifts) process.stdout.write(`  ${formatFixtureSummary(d)}\n`);

  if (verbose) {
    for (const d of drifts) process.stdout.write(`${formatFixtureVerbose(d)}\n`);
    for (const a of pageReports) process.stdout.write(`${formatPageAllocations(a)}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(
    `fixtures-gen compare failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
