/**
 * Discover docx files in the corpus directory tree.
 *
 * Walks `tests/corpus/<origin>/<category>/<slug>/source.docx`, returning
 * per-file paths plus the category derived from the parent folders.
 *
 * Each entry is shaped so the runner can:
 *   - Locate the source docx
 *   - Decide where to write reference / sobree artifacts
 *   - Find or create the baseline directory for regression comparison
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface CorpusEntry {
  /** Stable slug used in reports / CI output. */
  slug: string;
  /** Origin dir name under `tests/corpus/` (e.g. "generated"). The
   *  gitignored, local-only real-world corpus is discovered the same
   *  way when present — no origin is named in code. */
  origin: string;
  /** Category folder name (e.g. "form", "paragraph", "list"). */
  category: string;
  /** Absolute path to the docx file. */
  docxPath: string;
  /** Directory where companion artifacts live (renders, snapshots,
   *  baselines). Always the slug folder. */
  artifactDir: string;
  /** Per-engine sub-dir for render outputs. Created if missing. */
  libreofficeDir: string;
  sobreeDir: string;
  /** Where the committed regression baseline lives. */
  baselineDir: string;
}

export interface DiscoverOptions {
  repoRoot: string;
  /** Filter to a single slug (matches against entry.slug). */
  filterSlug?: string;
}

export function discoverCorpus(opts: DiscoverOptions): CorpusEntry[] {
  const out: CorpusEntry[] = [];

  const corpusRoot = join(opts.repoRoot, "tests", "corpus");
  if (existsSync(corpusRoot)) {
    // Scan whatever origin dirs exist under tests/corpus/ rather than
    // naming any. The synthetic `generated/` corpus is committed; the
    // real-world corpus is gitignored and local-only, so it is present
    // (and discovered) only on a contributor's machine, never in CI.
    for (const origin of safeDirs(corpusRoot)) {
      const originDir = join(corpusRoot, origin);
      for (const category of safeDirs(originDir)) {
        const categoryDir = join(originDir, category);
        for (const slugDir of safeDirs(categoryDir)) {
          const slugPath = join(categoryDir, slugDir);
          const docx = join(slugPath, "source.docx");
          if (!existsSync(docx)) continue;
          out.push({
            slug: slugDir,
            origin,
            category,
            docxPath: docx,
            artifactDir: slugPath,
            libreofficeDir: join(slugPath, "libreoffice"),
            sobreeDir: join(slugPath, "sobree"),
            baselineDir: join(slugPath, "baseline"),
          });
        }
      }
    }
  }

  if (opts.filterSlug) {
    return out.filter((e) => e.slug === opts.filterSlug);
  }
  return out;
}

/**
 * Path relative to the repo root — for human-readable report output.
 * Falls back to the absolute path if `from` isn't an ancestor.
 */
export function relPath(absolute: string, from: string): string {
  const r = relative(from, absolute);
  return r.startsWith("..") ? absolute : r;
}

function safeDirs(dir: string): string[] {
  return readdirSync(dir).filter((name) => {
    try {
      return statSync(join(dir, name)).isDirectory();
    } catch {
      return false;
    }
  });
}
