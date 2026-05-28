/**
 * PDF → per-page text-item extractor.
 *
 * Wraps `pdfjs-dist`'s legacy build (which works in Node without a
 * canvas dependency for text-only extraction) and yields raw text
 * items per page. The items still need clustering into visual lines —
 * that's `cluster.ts`'s job, kept separate so the geometry math is
 * unit-testable without involving real PDFs.
 */

import { readFileSync } from "node:fs";

export interface RawTextItem {
  /** Glyph string for this item (one item ≈ one styled run on a line). */
  text: string;
  /** PDF user-space x (origin bottom-left). */
  x: number;
  /** PDF user-space y. Larger = higher on page. */
  y: number;
  /** Visual width of `text`. */
  width: number;
  /** Reported text height (pt). */
  height: number;
  /** Font name as reported by pdfjs (e.g. `Cambria-Bold`). */
  fontName: string;
  /** Font size in pt, from the transform's vertical scale. */
  fontSize: number;
}

export interface RawPage {
  page: number;
  width: number;
  height: number;
  items: RawTextItem[];
}

interface PdfJsTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
}

export async function extractTextItems(pdfPath: string): Promise<RawPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = readFileSync(pdfPath);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;

  const pages: RawPage[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent({ includeMarkedContent: false });
    const items = (content.items as PdfJsTextItem[])
      .filter((it) => "str" in it && it.str.length > 0)
      .map(
        (it): RawTextItem => ({
          text: it.str,
          x: it.transform[4],
          y: it.transform[5],
          width: it.width,
          height: it.height,
          fontName: it.fontName,
          // d component of the affine transform = vertical scale = font size in pt.
          fontSize: Math.round(Math.abs(it.transform[3]) * 100) / 100,
        }),
      );
    pages.push({ page: pageNum, width: viewport.width, height: viewport.height, items });
  }

  await doc.cleanup();
  await doc.destroy();
  return pages;
}
