/**
 * CLI: run the corpus through the full rendering-fidelity pipeline
 * and either record a baseline or check the current render against
 * the committed baseline.
 *
 *   pnpm corpus:render   — render each doc via LibreOffice + extract
 *                          line metrics + render page PNGs
 *   pnpm corpus:diff     — compute drift score vs Sobree snapshots
 *                          (snapshots come from the oracle test;
 *                          run `pnpm test -- fixtures.oracle` first
 *                          to refresh them)
 *   pnpm corpus:check    — diff + compare to committed baseline,
 *                          exit non-zero on regression
 *   pnpm corpus:baseline — diff + write current scores as the new
 *                          committed baseline (use after intentional
 *                          renderer changes; commit the result)
 *
 * Filter to a single doc by passing its slug:
 *   pnpm corpus:check jellap
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { discoverCorpus, type CorpusEntry, relPath } from "./corpus/discover";
import {
  type CorpusScore,
  compareToBaseline,
  scoreFromDrift,
} from "./corpus/score";
import { findSoffice, convertDocxToPdf } from "./pdf/soffice";
import { extractTextItems } from "./pdf/extract";
import { clusterIntoLines } from "./pdf/cluster";
import { renderPdfPages } from "./pdf/render";
import type { FixtureMetrics } from "./pdf/types";
import { loadSnapshot } from "./compare/snapshot";
import { matchBlocksToLines, flattenLines } from "./compare/match";
import { buildDrift } from "./compare/drift";
import { summarisePages } from "./compare/pages";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

type Mode = "render" | "diff" | "check" | "baseline";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const mode = (argv[0] ?? "diff") as Mode;
  const filterSlug = argv.slice(1).find((a) => !a.startsWith("-"));

  const entries = discoverCorpus({
    repoRoot: REPO_ROOT,
    filterSlug,
  });

  if (entries.length === 0) {
    process.stderr.write(
      filterSlug
        ? `No corpus entry found matching slug "${filterSlug}".\n`
        : `No corpus entries discovered.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `corpus: ${entries.length} ${entries.length === 1 ? "entry" : "entries"} discovered\n`,
  );

  if (mode === "render") {
    await renderAll(entries);
    return;
  }

  // For diff / check / baseline we need a libreoffice render present.
  // Auto-render anything missing so the user doesn't have to remember
  // the two-step `render` then `diff` dance for fresh corpus files.
  await renderMissing(entries);

  const results = await scoreAll(entries);
  printResults(results, mode);

  if (mode === "baseline") {
    for (const r of results) writeBaseline(r.entry, r.score);
    process.stdout.write(
      `\nbaseline updated for ${results.length} entries — review and commit\n`,
    );
    return;
  }

  if (mode === "check") {
    const regressions = results.filter((r) => r.regressions.length > 0);
    if (regressions.length === 0) {
      process.stdout.write("\nall corpus entries within baseline tolerance\n");
      return;
    }
    process.stderr.write(
      `\n${regressions.length} ${regressions.length === 1 ? "entry" : "entries"} regressed:\n`,
    );
    for (const r of regressions) {
      process.stderr.write(`\n  ${r.entry.slug}\n`);
      for (const reg of r.regressions) {
        process.stderr.write(
          `    ${reg.metric}: baseline=${fmt(reg.baseline)} → current=${fmt(reg.current)} (Δ ${fmt(reg.delta)}, tolerance ${fmt(reg.tolerance)})\n`,
        );
      }
    }
    process.exit(1);
  }
}

interface ScoredEntry {
  entry: CorpusEntry;
  score: CorpusScore;
  baseline: CorpusScore | null;
  regressions: ReturnType<typeof compareToBaseline>;
}

async function renderAll(entries: CorpusEntry[]): Promise<void> {
  const soffice = await findSoffice();
  for (const entry of entries) {
    process.stdout.write(`render ${entry.slug} ... `);
    await renderEntry(entry, soffice);
    process.stdout.write("ok\n");
  }
}

async function renderMissing(entries: CorpusEntry[]): Promise<void> {
  const missing = entries.filter(
    (e) => !existsSync(libreofficeMetricsPath(e)),
  );
  if (missing.length === 0) return;
  process.stdout.write(`rendering ${missing.length} missing libreoffice baselines...\n`);
  await renderAll(missing);
}

async function renderEntry(entry: CorpusEntry, soffice: string): Promise<void> {
  mkdirSync(entry.libreofficeDir, { recursive: true });
  const tmpDir = mkdtempSync(join(tmpdir(), "corpus-"));
  try {
    const pdfPath = await convertDocxToPdf(soffice, entry.docxPath, tmpDir);
    const rawPages = await extractTextItems(pdfPath);
    const first = rawPages[0];
    const metrics: FixtureMetrics = {
      fixture: entry.slug,
      pdfSizePt: first
        ? { width: first.width, height: first.height }
        : { width: 0, height: 0 },
      pages: rawPages.map((p) => ({
        page: p.page,
        lines: clusterIntoLines(p.items),
      })),
    };
    writeFileSync(
      libreofficeMetricsPath(entry),
      `${JSON.stringify(metrics, null, 2)}\n`,
      "utf8",
    );
    await renderPdfPages(pdfPath, (n) =>
      join(entry.libreofficeDir, `page-${n}.png`),
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function scoreAll(entries: CorpusEntry[]): Promise<ScoredEntry[]> {
  const out: ScoredEntry[] = [];
  for (const entry of entries) {
    const metricsPath = libreofficeMetricsPath(entry);
    if (!existsSync(metricsPath)) {
      process.stderr.write(
        `skip ${entry.slug} — missing ${relPath(metricsPath, REPO_ROOT)}\n`,
      );
      continue;
    }
    const metrics = JSON.parse(readFileSync(metricsPath, "utf8")) as FixtureMetrics;
    const allocation = summarisePages(metrics);
    const libreofficePages = metrics.pages.length;

    const snapshotPath = sobreeSnapshotPath(entry);
    if (!existsSync(snapshotPath)) {
      process.stderr.write(
        `skip ${entry.slug} — no sobree snapshot at ${relPath(snapshotPath, REPO_ROOT)} (run \`pnpm test -- fixtures.oracle\` first)\n`,
      );
      continue;
    }
    const blocks = loadSnapshot(snapshotPath);
    const flatLines = flattenLines(metrics.pages);
    const matches = matchBlocksToLines(blocks, flatLines);
    const drift = buildDrift(entry.slug, matches);

    // sobreePages: pages.json doesn't carry Sobree's page count
    // directly — for now treat the snapshot's perceived page count as
    // unknown and lean on the pdf metric pageCount for the gate.
    // Wiring Sobree's actual paginated page count into the snapshot
    // is a follow-up the oracle test can capture.
    const sobreePages: number | null = null;

    const score = scoreFromDrift(drift, libreofficePages, sobreePages);
    const baseline = readBaseline(entry);
    const regressions = compareToBaseline(score, baseline);
    out.push({ entry, score, baseline, regressions });

    void allocation;
  }
  return out;
}

function printResults(results: ScoredEntry[], mode: Mode): void {
  const sorted = results.slice().sort((a, b) => {
    const ad = a.score.meanAbsDrift ?? 0;
    const bd = b.score.meanAbsDrift ?? 0;
    return bd - ad;
  });
  const lines = sorted.map((r) => {
    const drift = r.score.meanAbsDrift === null ? "—" : r.score.meanAbsDrift.toFixed(3);
    const pages = `${r.score.libreofficePages}p`;
    const matched = `${r.score.matchedBlocks}/${r.score.blockCount}`;
    const flag =
      mode === "check" && r.regressions.length > 0
        ? "✗"
        : r.baseline === null
          ? "·"
          : "✓";
    return `  ${flag} ${r.entry.slug.padEnd(40)} drift=${drift.padStart(6)} ${pages.padStart(4)} matched=${matched}`;
  });
  process.stdout.write(`\n${lines.join("\n")}\n`);
}

function fmt(n: number | null): string {
  if (n === null) return "—";
  return n.toFixed(3);
}

function libreofficeMetricsPath(entry: CorpusEntry): string {
  return join(entry.libreofficeDir, "metrics.json");
}

function sobreeSnapshotPath(entry: CorpusEntry): string {
  return join(entry.sobreeDir, "snapshot.json");
}

function baselineScorePath(entry: CorpusEntry): string {
  return join(entry.baselineDir, "score.json");
}

function readBaseline(entry: CorpusEntry): CorpusScore | null {
  const path = baselineScorePath(entry);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CorpusScore;
  } catch {
    return null;
  }
}

function writeBaseline(entry: CorpusEntry, score: CorpusScore): void {
  const path = baselineScorePath(entry);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(score, null, 2)}\n`, "utf8");
}

main().catch((err) => {
  process.stderr.write(
    `corpus failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
