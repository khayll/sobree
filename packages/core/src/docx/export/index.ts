import { makeExportContext } from "./context";
import {
  renderContentTypesXml,
  renderDocumentRelsXml,
  renderRootRelsXml,
} from "./contentTypes";
import { renderDocumentXml } from "./document";
import { emitHeadersAndFooters } from "./headers";
import { renderStylesXml } from "./styles";
import { type DocxParts, packageDocx } from "./zip";
import { collectLivePartPaths } from "../../doc/parts";
import { mountFontTableArtifacts } from "../../fonts";
import type { SobreeDocument } from "../../doc/types";
import type { DocxExportResult } from "../types";

/**
 * Export a SobreeDocument as a .docx Blob + raw bytes.
 *
 * Emits the OOXML package:
 *   - `[Content_Types].xml`, `_rels/.rels`,
 *     `word/_rels/document.xml.rels`
 *   - `word/styles.xml`, `word/document.xml`
 *   - `word/header*.xml` / `word/footer*.xml` (per header/footer reference)
 *   - `word/media/*` (per referenced image) — copied verbatim from
 *     `doc.rawParts` and declared as image relationships.
 */
export function exportDocx(doc: SobreeDocument): DocxExportResult {
  const warnings: string[] = [];

  // rId1 = styles relationship (written by renderDocumentRelsXml).
  // Headers / footers / images allocate from rId2 upwards.
  const ctx = makeExportContext(2);

  // Emit header/footer parts first so they populate ctx before the body
  // walker starts (order doesn't affect rId allocation since images in
  // headers/footers are walked inside emitHeadersAndFooters too). The
  // returned array carries one `<w:sectPr>` per section — non-final
  // ones get spliced into paragraph pPrs by `renderDocumentXml`.
  const sectPrXmls = emitHeadersAndFooters(doc, ctx);

  // Walk the body, emitting drawings that register image parts in ctx.
  const documentXml = renderDocumentXml(doc, sectPrXmls, ctx);

  // Font table — staged before the safety-net loop so embedded font
  // partPaths are still picked up there. The fonts module owns all
  // the part / rel / content-type bookkeeping.
  mountFontTableArtifacts(doc, ctx);

  // Safety net: emitters above stage every referenced part into
  // `ctx.parts` as they encounter it. This loop catches any live part
  // whose bytes live in `doc.rawParts` but never got staged through an
  // emitter (defensive — keeps export aligned with the "AST is the
  // source of truth" policy, and lets future emitters skip the manual
  // `ctx.parts[path] = doc.rawParts[path]` copy).
  const live = collectLivePartPaths(doc);
  for (const path of live) {
    if (ctx.parts[path]) continue;
    const bytes = doc.rawParts[path];
    if (bytes) ctx.parts[path] = bytes;
  }

  const parts: DocxParts = {
    "[Content_Types].xml": renderContentTypesXml(
      ctx.contentTypeOverrides,
      Array.from(ctx.mediaExtensions),
    ),
    "_rels/.rels": renderRootRelsXml(),
    "word/_rels/document.xml.rels": renderDocumentRelsXml(ctx.relationships),
    "word/document.xml": documentXml,
    "word/styles.xml": renderStylesXml(doc.styles),
    ...ctx.parts,
  };

  const pkg = packageDocx(parts);
  return { blob: pkg.blob, bytes: pkg.bytes, warnings };
}
