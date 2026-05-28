/**
 * CLI: render every `.docx` fixture via LibreOffice to PDF, then
 * rasterise each PDF page to `<name>.libreoffice.pN.jpg` next to the
 * fixture. Separate from `<name>.jpg` (which some fixtures use for a
 * manually-captured Word screenshot).
 *
 * The output images are the pixel reference for any "did this break?"
 * eyeball check — same calibration target the drift report uses.
 *
 * Optional positional arg restricts to one fixture, e.g.:
 *   pnpm fixtures:images user-contract.docx
 */

import { mkdtempSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { findSoffice, convertDocxToPdf } from "./pdf/soffice";
import { renderPdfPages } from "./pdf/render";

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
  const fixtureFilter = process.argv.find((a) => a.endsWith(".docx"));
  const soffice = await findSoffice();
  process.stdout.write(`Using ${soffice}\n\n`);

  const tmp = mkdtempSync(join(tmpdir(), "sobree-libreoffice-img-"));
  let failures = 0;
  try {
    const entries = await readdir(FIXTURES_DIR);
    const docxFiles = entries
      .filter((f) => f.endsWith(".docx") && !f.startsWith("~$"))
      .filter((f) => !fixtureFilter || f === fixtureFilter)
      .sort();

    for (const fileName of docxFiles) {
      try {
        const docxPath = join(FIXTURES_DIR, fileName);
        const pdfPath = await convertDocxToPdf(soffice, docxPath, tmp);
        const base = fileName.replace(/\.docx$/i, "");
        const { pageCount } = await renderPdfPages(pdfPath, (n) =>
          join(FIXTURES_DIR, `${base}.libreoffice.p${n}.jpg`),
        );
        process.stdout.write(`✓ ${fileName} → ${pageCount} image(s)\n`);
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
    process.stderr.write(`\n${failures} fixture(s) failed image render.\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(
    `fixtures-gen images failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
