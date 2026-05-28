/**
 * CLI: render every `.docx` fixture via LibreOffice and extract
 * per-line layout metrics from the resulting PDF.
 *
 * Output `<name>.libreoffice.json` lands next to the docx. That file
 * is Sobree's rendering-oracle baseline — actual point-precise text
 * positions from a Word-faithful renderer, no eyeballing.
 *
 * Requires `soffice` (or `libreoffice`) on PATH or the canonical
 * macOS install location. See `pdf/soffice.ts` for the search list.
 *
 * Composition:
 *   pdf/soffice.ts   — find + run soffice
 *   pdf/extract.ts   — pdfjs → raw text items per page
 *   pdf/cluster.ts   — group items into visual lines
 *   pdf/types.ts     — `LineMetric`, `FixtureMetrics`
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { findSoffice, convertDocxToPdf } from "./pdf/soffice";
import { extractTextItems } from "./pdf/extract";
import { clusterIntoLines } from "./pdf/cluster";
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

async function extractFixture(
  soffice: string,
  docxPath: string,
  fileName: string,
  tmpDir: string,
): Promise<FixtureMetrics> {
  const pdfPath = await convertDocxToPdf(soffice, docxPath, tmpDir);
  const rawPages = await extractTextItems(pdfPath);
  const first = rawPages[0];
  return {
    fixture: fileName,
    pdfSizePt: first
      ? { width: first.width, height: first.height }
      : { width: 0, height: 0 },
    pages: rawPages.map((p) => ({
      page: p.page,
      lines: clusterIntoLines(p.items),
    })),
  };
}

async function main(): Promise<void> {
  const soffice = await findSoffice();
  process.stdout.write(`Using ${soffice}\n\n`);

  const tmp = mkdtempSync(join(tmpdir(), "sobree-libreoffice-"));
  let failures = 0;
  try {
    const entries = await readdir(FIXTURES_DIR);
    const docxFiles = entries
      .filter((f) => f.endsWith(".docx") && !f.startsWith("~$"))
      .sort();

    for (const fileName of docxFiles) {
      try {
        const docxPath = join(FIXTURES_DIR, fileName);
        const metrics = await extractFixture(soffice, docxPath, fileName, tmp);
        const outPath = join(
          FIXTURES_DIR,
          fileName.replace(/\.docx$/i, ".libreoffice.json"),
        );
        writeFileSync(outPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
        const lineCount = metrics.pages.reduce(
          (sum, page) => sum + page.lines.length,
          0,
        );
        process.stdout.write(
          `✓ ${fileName} → ${metrics.pages.length} page(s), ${lineCount} line(s)\n`,
        );
      } catch (err) {
        failures += 1;
        process.stderr.write(
          `✗ ${fileName} — ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  if (failures > 0) {
    process.stderr.write(`\n${failures} fixture(s) failed extraction.\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(
    `fixtures-gen extract failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
