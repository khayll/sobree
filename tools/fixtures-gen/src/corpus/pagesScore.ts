/**
 * Score the LIVE paginator's output vs LibreOffice's reference pages.
 *
 * Complements `score.ts` (import-level drift): that gate never runs the
 * real paginator, so a fixture can drift from 14 to 13 pages without it
 * noticing. This one takes what the browser actually rendered
 * (per-paper `innerText`, from apps/playground/src/corpusHarness.ts)
 * and reduces it to two numbers the CI gate can compare against a
 * committed baseline:
 *
 *   - `pageCountDelta` — |Sobree pages − LibreOffice pages|. The
 *     headline pagination metric; must never grow past baseline.
 *   - `pageTextOverlap` — mean over pages of "fraction of LO's lines
 *     on page N whose text appears on Sobree's page N". Catches
 *     break-position drift even when the total page count matches
 *     (content sliding across a boundary lowers both pages' ratios).
 *     Substring matching on normalised text makes it robust to the
 *     engines wrapping lines differently.
 *
 * Baseline file: `<artifactDir>/baseline/pages.json`.
 */

export interface PagesScore {
  sobreePages: number;
  libreofficePages: number;
  pageCountDelta: number;
  /** Null when no page had a scorable LO line (e.g. image-only doc). */
  pageTextOverlap: number | null;
}

export interface PagesPerPage {
  page: number;
  loLines: number;
  matched: number;
  overlap: number;
}

export const PAGES_TOLERANCE = {
  /** Pagination must not drift further from LO than the baseline. */
  pageCountDelta: 0,
  /** Allowed drop in mean per-page text overlap before flagging —
   *  covers font-metric jitter moving a single short line. */
  pageTextOverlapDrop: 0.02,
};

/** Below this many normalised chars a line is too generic to anchor a
 *  page (page numbers, bullets, "1."), so it doesn't count either way. */
const MIN_LINE_CHARS = 8;

export function scorePages(
  loPages: Array<{ lines: Array<{ text: string }> }>,
  pageTexts: string[],
): { score: PagesScore; perPage: PagesPerPage[] } {
  const perPage: PagesPerPage[] = [];
  for (let i = 0; i < loPages.length; i++) {
    const loLines = (loPages[i]?.lines ?? [])
      .map((l) => lineVariants(l.text))
      .filter((v) => v.length > 0);
    if (loLines.length === 0) continue;
    const sobreeText = normalise(pageTexts[i] ?? "");
    const matched = loLines.filter((variants) =>
      variants.some((v) => sobreeText.includes(v)),
    ).length;
    perPage.push({
      page: i + 1,
      loLines: loLines.length,
      matched,
      overlap: matched / loLines.length,
    });
  }
  const overlap =
    perPage.length === 0 ? null : perPage.reduce((s, p) => s + p.overlap, 0) / perPage.length;
  return {
    score: {
      sobreePages: pageTexts.length,
      libreofficePages: loPages.length,
      pageCountDelta: Math.abs(pageTexts.length - loPages.length),
      pageTextOverlap: overlap === null ? null : round3(overlap),
    },
    perPage,
  };
}

export interface PagesRegression {
  metric: keyof PagesScore;
  baseline: number | null;
  current: number | null;
  delta: number;
  tolerance: number;
}

/** Empty array when within tolerance. Unset baselines never regress. */
export function comparePagesToBaseline(
  current: PagesScore,
  baseline: PagesScore | null,
): PagesRegression[] {
  if (!baseline) return [];
  const out: PagesRegression[] = [];

  const countDelta = current.pageCountDelta - baseline.pageCountDelta;
  if (countDelta > PAGES_TOLERANCE.pageCountDelta) {
    out.push({
      metric: "pageCountDelta",
      baseline: baseline.pageCountDelta,
      current: current.pageCountDelta,
      delta: countDelta,
      tolerance: PAGES_TOLERANCE.pageCountDelta,
    });
  }

  if (current.pageTextOverlap !== null && baseline.pageTextOverlap !== null) {
    const drop = baseline.pageTextOverlap - current.pageTextOverlap;
    if (drop > PAGES_TOLERANCE.pageTextOverlapDrop) {
      out.push({
        metric: "pageTextOverlap",
        baseline: baseline.pageTextOverlap,
        current: current.pageTextOverlap,
        delta: -drop,
        tolerance: PAGES_TOLERANCE.pageTextOverlapDrop,
      });
    }
  }

  return out;
}

/** Leading list-enumeration token: "1.", "(a)", "iv)", "3:" …
 *  Sobree renders list markers as CSS `::before` boxes, which
 *  `innerText` can't see — so a marker-stripped variant of the LO line
 *  must also count as a match. The item text still anchors the page,
 *  so stripping loses no break-position signal. */
const ENUM_MARKER = /^\s*\(?(?:[0-9]{1,3}|[ivxlcdm]{1,7}|[a-z])[.):\]]\s+/i;

/** Normalised forms a LO line may take on the Sobree page. Empty when
 *  the line is too short to anchor a page (page numbers, lone bullets). */
function lineVariants(raw: string): string[] {
  const out: string[] = [];
  const full = normalise(raw);
  if (full.length >= MIN_LINE_CHARS) out.push(full);
  const stripped = raw.replace(ENUM_MARKER, "");
  if (stripped !== raw) {
    const alt = normalise(stripped);
    if (alt.length >= MIN_LINE_CHARS) out.push(alt);
  }
  return out;
}

/** NFKC-fold ligatures (ﬁ → fi), case-fold, and strip everything
 *  non-alphanumeric so PDF extraction quirks (NBSP, soft hyphens,
 *  quote styles) don't break the substring containment check. */
function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
