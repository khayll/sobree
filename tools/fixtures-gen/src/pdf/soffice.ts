/**
 * LibreOffice-via-CLI wrapper.
 *
 * Finds the `soffice` (or `libreoffice`) binary on PATH or in the
 * canonical macOS install location, and shells it to convert a single
 * `.docx` to PDF in headless mode.
 *
 * Keeping this concern isolated lets the extractor focus on PDF →
 * metric extraction without juggling subprocess plumbing.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Locations searched in order. Brew Cask installs LibreOffice as an
 * `.app` bundle and doesn't symlink to PATH on macOS, so the bundle
 * binary is checked explicitly. Linux distros put `soffice` /
 * `libreoffice` on PATH by default.
 */
const SEARCH = ["soffice", "libreoffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"];

export async function findSoffice(): Promise<string> {
  for (const candidate of SEARCH) {
    try {
      if (candidate.startsWith("/") && !existsSync(candidate)) continue;
      await execFileAsync(candidate, ["--version"], { timeout: 10_000 });
      return candidate;
    } catch {
      /* try next */
    }
  }
  throw new Error(
    `LibreOffice (soffice) not found. Searched: ${SEARCH.join(", ")}. Install with \`brew install --cask libreoffice\` on macOS, or your distro's libreoffice package on Linux.`,
  );
}

/**
 * Render a `.docx` to PDF via `soffice --headless --convert-to pdf`.
 * Returns the produced PDF's absolute path inside `outDir`.
 *
 * LibreOffice writes the PDF to `outDir/<basename>.pdf` regardless of
 * the input path. We verify the file exists before returning so the
 * caller doesn't get cryptic ENOENTs downstream.
 */
export async function convertDocxToPdf(
  soffice: string,
  docxPath: string,
  outDir: string,
): Promise<string> {
  await execFileAsync(
    soffice,
    ["--headless", "--convert-to", "pdf", "--outdir", outDir, docxPath],
    { timeout: 60_000 },
  );
  const basename = docxPath
    .split("/")
    .pop()!
    .replace(/\.docx$/i, ".pdf");
  const pdfPath = join(outDir, basename);
  if (!existsSync(pdfPath)) {
    throw new Error(`soffice exited 0 but expected PDF at ${pdfPath} was not produced.`);
  }
  return pdfPath;
}
