/**
 * Browser side of the live-paginator corpus gate (`pnpm corpus:pages`).
 *
 * The oracle-snapshot gate (`pnpm corpus:check`) compares AST-level
 * imports and never runs the real paginator, so page-count and
 * break-position regressions are invisible to it. This harness gives
 * the CLI runner (tools/fixtures-gen/src/corpusPages.ts) a way to load
 * a corpus fixture into the REAL editor and read back what the live
 * paginator produced.
 *
 * Installed dev-only as `window.__corpusPages(slug)` — driven headless
 * via Playwright, or callable by hand from the console.
 */

import type { SobreeHandle } from "@sobree/core";

export interface CorpusPageSummary {
  /** Papers actually in the DOM after pagination settled. */
  pageCount: number;
  /** `innerText` of each `.paper` (body + header/footer zones), in order. */
  pageTexts: string[];
  /** False when pagination never went quiet within the timeout — the
   *  counts are then mid-flight garbage and must not be scored. */
  settled: boolean;
  warnings: string[];
}

export type CorpusPagesResult = CorpusPageSummary | { error: string };

/** Pagination re-runs asynchronously (rAF passes + font-settle
 *  repagination), so "done" is only observable as a quiet window: no
 *  `paginate` event for this long after the last one. Rapid loads
 *  without this wait report garbage counts. */
const QUIET_MS = 1000;
const SETTLE_TIMEOUT_MS = 30_000;

export function installCorpusHarness(editor: SobreeHandle): void {
  (window as unknown as { __corpusPages: unknown }).__corpusPages = (slug: string) =>
    corpusPages(editor, slug);
}

async function corpusPages(editor: SobreeHandle, slug: string): Promise<CorpusPagesResult> {
  const url = `/__corpus/${slug}/source.docx`;
  let blob: Blob;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  } catch (err) {
    return { error: `failed to fetch ${url}: ${(err as Error).message}` };
  }

  // Subscribe before loading so the initial pagination pass is counted —
  // a doc that paginates once and goes quiet would otherwise never
  // satisfy the "at least one paginate seen" settle condition.
  let lastPaginateAt = performance.now();
  let paginateCount = 0;
  const off = editor.on("paginate", () => {
    lastPaginateAt = performance.now();
    paginateCount += 1;
  });

  try {
    const { warnings } = await editor.loadDocx(blob);
    await document.fonts.ready;
    const settled = await waitForQuiet(
      () => paginateCount > 0 && performance.now() - lastPaginateAt >= QUIET_MS,
    );
    const pageTexts = extractPageTexts(editor);
    return { pageCount: pageTexts.length, pageTexts, settled, warnings };
  } catch (err) {
    return { error: `loadDocx failed for ${slug}: ${(err as Error).message}` };
  } finally {
    off();
  }
}

async function waitForQuiet(isQuiet: () => boolean): Promise<boolean> {
  const start = performance.now();
  while (performance.now() - start < SETTLE_TIMEOUT_MS) {
    if (isQuiet()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return isQuiet();
}

/** `innerText` (not `textContent`) so CSS-hidden content stays out of
 *  the extraction — a block wrongly rendered invisible should score as
 *  missing, not silently pass. */
function extractPageTexts(editor: SobreeHandle): string[] {
  const papers = Array.from(editor.sobree.stackRoot.querySelectorAll<HTMLElement>(".paper"));
  return papers.map((paper) => paper.innerText);
}
