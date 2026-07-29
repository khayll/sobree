/**
 * Opaque package-part pass-through — the plan's "preserve-opaque for
 * PARTS, not inline body XML" decision, executed.
 *
 * These parts are not modeled by the AST but their loss is real:
 * `settings.xml` carries Word behavior (default tab stop, compat flags,
 * footnote numbering, `w:evenAndOddHeaders`), `theme1.xml` is what
 * `styles.xml`'s theme font/color references resolve against (34 of 46
 * corpus docs carry one — dropping it re-opens them in Word with
 * fallback fonts), docProps are the document's metadata, and customXml
 * items back data-bound content controls. All exist verbatim in
 * `doc.rawParts`; this module re-emits them byte-for-byte with the
 * relationships and content types each one requires.
 *
 * NOT handled here (deliberately): any part the AST models (document,
 * styles, numbering, notes, headers/footers, media) — those are
 * REGENERATED, which is what keeps the fixpoint honest.
 */

import type { SobreeDocument } from "../../doc/types";
import type { ExportContext } from "./context";

const CT = {
  settings: "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml",
  webSettings: "application/vnd.openxmlformats-officedocument.wordprocessingml.webSettings+xml",
  theme: "application/vnd.openxmlformats-officedocument.theme+xml",
  coreProps: "application/vnd.openxmlformats-package.core-properties+xml",
  extendedProps: "application/vnd.openxmlformats-officedocument.extended-properties+xml",
  customProps: "application/vnd.openxmlformats-officedocument.custom-properties+xml",
  customXmlProps: "application/vnd.openxmlformats-officedocument.customXmlProperties+xml",
} as const;

const ROOT_REL = {
  coreProps:
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
  extendedProps:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
  customProps:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties",
} as const;

/**
 * Stage every opaque part present in `doc.rawParts`. Returns the extra
 * PACKAGE-level relationships (`_rels/.rels`) the staged docProps parts
 * need — document-level rels and content types are pushed onto `ctx`
 * directly.
 */
export function emitOpaqueParts(
  doc: SobreeDocument,
  ctx: ExportContext,
): { type: string; target: string }[] {
  const stage = (path: string): boolean => {
    const bytes = doc.rawParts[path];
    if (!bytes || ctx.parts[path]) return false;
    ctx.parts[path] = bytes;
    return true;
  };

  // word/-scoped parts referenced from document.xml.rels.
  if (stage("word/settings.xml")) {
    ctx.contentTypeOverrides.push({ partName: "/word/settings.xml", contentType: CT.settings });
    ctx.relationships.push({ id: `rId${ctx.nextRid++}`, type: "settings", target: "settings.xml" });
  }
  if (stage("word/webSettings.xml")) {
    ctx.contentTypeOverrides.push({
      partName: "/word/webSettings.xml",
      contentType: CT.webSettings,
    });
    ctx.relationships.push({
      id: `rId${ctx.nextRid++}`,
      type: "webSettings",
      target: "webSettings.xml",
    });
  }
  if (stage("word/theme/theme1.xml")) {
    ctx.contentTypeOverrides.push({ partName: "/word/theme/theme1.xml", contentType: CT.theme });
    ctx.relationships.push({
      id: `rId${ctx.nextRid++}`,
      type: "theme",
      target: "theme/theme1.xml",
    });
  }

  // customXml/ tree: items rel from document.xml.rels, their props +
  // per-item rels verbatim. Word numbers items itemN / itemPropsN.
  for (const path of Object.keys(doc.rawParts).sort()) {
    const m = path.match(/^customXml\/item(\d+)\.xml$/);
    if (!m) continue;
    if (stage(path)) {
      ctx.relationships.push({
        id: `rId${ctx.nextRid++}`,
        type: "customXml",
        target: `../${path}`,
      });
    }
    const props = `customXml/itemProps${m[1]}.xml`;
    if (stage(props)) {
      ctx.contentTypeOverrides.push({ partName: `/${props}`, contentType: CT.customXmlProps });
    }
    stage(`customXml/_rels/item${m[1]}.xml.rels`);
  }

  // docProps: package-level rels, returned for renderRootRelsXml.
  const rootRels: { type: string; target: string }[] = [];
  // Package thumbnail — the preview image Explorer/Finder show. Its
  // extension rides the media-extension Defaults; the rel is package-level.
  const thumb = Object.keys(doc.rawParts).find((p) => /^docProps\/thumbnail\.\w+$/.test(p));
  if (thumb && stage(thumb)) {
    const ext = thumb.split(".").pop();
    if (ext) ctx.mediaExtensions.add(ext);
    rootRels.push({
      type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail",
      target: thumb,
    });
  }
  if (stage("docProps/core.xml")) {
    ctx.contentTypeOverrides.push({ partName: "/docProps/core.xml", contentType: CT.coreProps });
    rootRels.push({ type: ROOT_REL.coreProps, target: "docProps/core.xml" });
  }
  if (stage("docProps/app.xml")) {
    ctx.contentTypeOverrides.push({
      partName: "/docProps/app.xml",
      contentType: CT.extendedProps,
    });
    rootRels.push({ type: ROOT_REL.extendedProps, target: "docProps/app.xml" });
  }
  if (stage("docProps/custom.xml")) {
    ctx.contentTypeOverrides.push({
      partName: "/docProps/custom.xml",
      contentType: CT.customProps,
    });
    rootRels.push({ type: ROOT_REL.customProps, target: "docProps/custom.xml" });
  }
  return rootRels;
}
