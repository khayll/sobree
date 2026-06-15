/**
 * Emit `word/fontTable.xml` plus `word/_rels/fontTable.xml.rels`. Each
 * `FontDeclaration` becomes a `<w:font>` element; embeds turn into
 * `<w:embedRegular r:id="..." w:fontKey="..."/>` (and bold/italic
 * variants), with the matching font part exposed via the rels file.
 *
 * Two entry points:
 *   - `emitFontTable(doc)` — pure, returns the two XML strings; useful in tests.
 *   - `mountFontTableArtifacts(doc, ctx)` — orchestrates all the export-side
 *     bookkeeping (stage parts, allocate document-level rel, push content-type
 *     override, register .odttf extension). Called by `docx/export/index.ts`.
 */

import type { SobreeDocument } from "../doc/types";
import type { ExportContext } from "../docx/export/context";
import { NS } from "../docx/shared/namespaces";
import { el, xmlDocument } from "../docx/shared/xml";
import type { FontDeclaration, FontEmbedRef } from "./types";

interface FontTableEmission {
  /** Inner XML of `word/fontTable.xml`. */
  fontTableXml: string;
  /** Inner XML of `word/_rels/fontTable.xml.rels`. */
  fontTableRelsXml: string;
}

const FONT_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font";

const FONT_TABLE_CT =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml";

/**
 * Stage every font-related artifact into the export context: the
 * fontTable XML + companion rels, the document-level relationship,
 * the content-type override, and the `.odttf` extension flag. Caller
 * (docx/export/index.ts) just calls this once and forgets — no
 * font-aware code needs to live in the export entry point any more.
 *
 * No-op when `doc.fonts` is empty.
 */
export function mountFontTableArtifacts(doc: SobreeDocument, ctx: ExportContext): void {
  const emission = emitFontTable(doc);
  if (!emission) return;
  ctx.parts["word/fontTable.xml"] = emission.fontTableXml;
  ctx.parts["word/_rels/fontTable.xml.rels"] = emission.fontTableRelsXml;
  const fontTableRid = `rId${ctx.nextRid++}`;
  ctx.relationships.push({
    id: fontTableRid,
    type: "fontTable",
    target: "fontTable.xml",
  });
  ctx.contentTypeOverrides.push({
    partName: "/word/fontTable.xml",
    contentType: FONT_TABLE_CT,
  });
  // If any embed lands as an `.odttf`, register the extension so the
  // packager emits a `<Default Extension="odttf">` content-type entry.
  if (doc.fonts.some(hasObfuscatedEmbed)) ctx.mediaExtensions.add("odttf");
}

/**
 * Render the font table and its companion .rels. Returns null if the
 * document declares no fonts (caller skips emitting the parts).
 */
export function emitFontTable(doc: SobreeDocument): FontTableEmission | null {
  if (!doc.fonts || doc.fonts.length === 0) return null;

  // Allocate font-table-local rIds (rId1..rIdN). These IDs live in
  // `fontTable.xml.rels`, NOT in `document.xml.rels`, so they can
  // restart from 1 without colliding.
  let nextRid = 1;
  const fontRels: Array<{ id: string; target: string }> = [];

  const fontEls = doc.fonts.map((decl) => renderFontEl(decl, () => `rId${nextRid++}`, fontRels));

  const fontTableXml = xmlDocument(el("w:fonts", { "xmlns:w": NS.w, "xmlns:r": NS.r }, fontEls));

  const relEls = fontRels.map(({ id, target }) =>
    el("Relationship", { Id: id, Type: FONT_REL_TYPE, Target: target }),
  );
  const fontTableRelsXml = xmlDocument(el("Relationships", { xmlns: NS.rel }, relEls));

  return { fontTableXml, fontTableRelsXml };
}

function hasObfuscatedEmbed(decl: FontDeclaration): boolean {
  if (!decl.embed) return false;
  for (const ref of Object.values(decl.embed) as Array<FontEmbedRef | undefined>) {
    if (ref?.partPath.toLowerCase().endsWith(".odttf")) return true;
  }
  return false;
}

function renderFontEl(
  decl: FontDeclaration,
  allocRid: () => string,
  rels: Array<{ id: string; target: string }>,
): string {
  const children: string[] = [];
  if (decl.altName) children.push(el("w:altName", { "w:val": decl.altName }));
  if (decl.panose) children.push(el("w:panose1", { "w:val": decl.panose }));
  if (decl.charset) children.push(el("w:charset", { "w:val": decl.charset }));
  if (decl.family) children.push(el("w:family", { "w:val": decl.family }));
  if (decl.pitch) children.push(el("w:pitch", { "w:val": decl.pitch }));
  if (decl.notTrueType) children.push(el("w:notTrueType"));
  if (decl.sig) {
    children.push(
      el("w:sig", {
        "w:usb0": decl.sig.usb0,
        "w:usb1": decl.sig.usb1,
        "w:usb2": decl.sig.usb2,
        "w:usb3": decl.sig.usb3,
        "w:csb0": decl.sig.csb0,
        "w:csb1": decl.sig.csb1,
      }),
    );
  }

  if (decl.embed) {
    const slots: Array<["regular" | "bold" | "italic" | "boldItalic", string]> = [
      ["regular", "w:embedRegular"],
      ["bold", "w:embedBold"],
      ["italic", "w:embedItalic"],
      ["boldItalic", "w:embedBoldItalic"],
    ];
    for (const [key, tag] of slots) {
      const ref = decl.embed[key];
      if (!ref) continue;
      const rid = allocRid();
      const target = ref.partPath.startsWith("word/")
        ? ref.partPath.slice("word/".length)
        : ref.partPath;
      rels.push({ id: rid, target });
      const attrs: Record<string, string | undefined> = { "r:id": rid };
      if (ref.fontKey) attrs["w:fontKey"] = ref.fontKey;
      if (ref.subsetted) attrs["w:subsetted"] = "true";
      children.push(el(tag, attrs));
    }
  }

  return el("w:font", { "w:name": decl.name }, children);
}
