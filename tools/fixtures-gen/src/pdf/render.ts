/**
 * Render each page of a PDF to a JPEG image.
 *
 * Used by `pnpm fixtures:images` to produce a visual reference for
 * every fixture page. The images sit next to the docx as
 * `<name>.libreoffice.pN.jpg` — separate from manual `<name>.jpg`
 * (Word screenshots), so both can coexist.
 *
 * Uses `pdfjs-dist`'s canvas-render path with `@napi-rs/canvas` for
 * Node compatibility (pdfjs needs a Canvas implementation; the
 * legacy build doesn't bundle one).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { type SKRSContext2D, createCanvas } from "@napi-rs/canvas";

export async function renderPdfPages(
  pdfPath: string,
  outputPathFor: (pageNum: number) => string,
  scale = 1.5,
): Promise<{ pageCount: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = readFileSync(pdfPath);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    // pdfjs writes into the canvas via `canvasContext`. `@napi-rs/canvas`
    // implements the same 2D context API so this works headless.
    await page.render({ canvasContext: ctx, viewport }).promise;
    const buf = (canvas as unknown as { toBuffer: (mime: string) => Buffer }).toBuffer(
      "image/jpeg",
    );
    writeFileSync(outputPathFor(pageNum), buf);
    void (ctx as unknown as SKRSContext2D);
  }

  const pageCount = doc.numPages;
  await doc.cleanup();
  await doc.destroy();
  return { pageCount };
}
