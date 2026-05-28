/**
 * Parse `word/fontTable.xml` into `FontDeclaration[]`. Embedded font
 * binaries are NOT deobfuscated here — they stay in `rawParts` exactly
 * as Word wrote them so an unmodified round-trip preserves the bytes.
 * Renderer-side `@font-face` injection deobfuscates on demand.
 *
 * Two entry points:
 *   - `parseFontTable(xml, rels)` — pure parse, useful in tests.
 *   - `mountFontTableFromZip(textParts, parseRels)` — orchestrates the
 *     XML lookup + companion `.rels` lookup. Called by `docx/import`.
 */

import { NS } from "../docx/shared/namespaces";
import { parseXml, wAll, wChildren, wFirst, wVal } from "../docx/shared/xml";
import type { FontDeclaration, FontEmbedRef } from "./types";

interface Loaded {
  declarations: FontDeclaration[];
  /** ZIP paths of embedded font parts that should be kept in rawParts. */
  embeddedPartPaths: Set<string>;
}

/**
 * Convenience for the import pipeline: pull `word/fontTable.xml` +
 * `word/_rels/fontTable.xml.rels` out of the unzipped text-parts map
 * and return the parsed declarations. Falls back to an empty array
 * when the document carries no font table — most don't.
 *
 * `parseRels` is the same `parseRels` helper the document uses; passed
 * in to avoid a cycle through `docx/import`.
 */
export function mountFontTableFromZip(
  textParts: Record<string, string>,
  parseRels: (xml: string) => Map<string, string>,
): FontDeclaration[] {
  const fontTableXml = textParts["word/fontTable.xml"];
  if (!fontTableXml) return [];
  const fontTableRelsXml = textParts["word/_rels/fontTable.xml.rels"];
  const rels = fontTableRelsXml
    ? parseRels(fontTableRelsXml)
    : new Map<string, string>();
  return parseFontTable(fontTableXml, rels).declarations;
}

/**
 * Returns parsed declarations + the set of font-part ZIP paths the
 * unzipped binary map should retain. `fontTableRels` resolves `r:id`
 * references inside `<w:embed*>` elements to their target paths.
 */
export function parseFontTable(
  fontTableXml: string,
  fontTableRels: Map<string, string>,
): Loaded {
  const doc = parseXml(fontTableXml);
  const fonts = wAll(doc, "font");
  const declarations: FontDeclaration[] = [];
  const embeddedPartPaths = new Set<string>();

  for (const fEl of fonts) {
    const name =
      fEl.getAttributeNS(NS.w, "name") ?? fEl.getAttribute("w:name") ?? "";
    if (!name) continue;
    const decl: FontDeclaration = { name };

    const altName = wFirst(fEl, "altName");
    if (altName) {
      const v = wVal(altName);
      if (v) decl.altName = v;
    }
    const panose = wFirst(fEl, "panose1");
    if (panose) {
      const v = wVal(panose);
      if (v) decl.panose = v;
    }
    const charset = wFirst(fEl, "charset");
    if (charset) {
      const v = wVal(charset);
      if (v) decl.charset = v;
    }
    const family = wFirst(fEl, "family");
    if (family) {
      const v = wVal(family) as FontDeclaration["family"];
      if (v) decl.family = v;
    }
    const pitch = wFirst(fEl, "pitch");
    if (pitch) {
      const v = wVal(pitch) as FontDeclaration["pitch"];
      if (v) decl.pitch = v;
    }
    const sigEl = wFirst(fEl, "sig");
    if (sigEl) {
      const sig = readSig(sigEl);
      if (sig) decl.sig = sig;
    }
    if (wFirst(fEl, "notTrueType")) decl.notTrueType = true;

    const embed = readEmbed(fEl, fontTableRels);
    if (embed) {
      decl.embed = embed;
      for (const ref of Object.values(embed)) {
        if (ref?.partPath) embeddedPartPaths.add(ref.partPath);
      }
    }

    declarations.push(decl);
  }

  return { declarations, embeddedPartPaths };
}

function readSig(sigEl: Element): FontDeclaration["sig"] | null {
  const get = (name: string) =>
    sigEl.getAttributeNS(NS.w, name) ?? sigEl.getAttribute(`w:${name}`);
  const usb0 = get("usb0");
  const usb1 = get("usb1");
  const usb2 = get("usb2");
  const usb3 = get("usb3");
  const csb0 = get("csb0");
  const csb1 = get("csb1");
  if (!usb0 && !usb1 && !usb2 && !usb3 && !csb0 && !csb1) return null;
  return {
    usb0: usb0 ?? "00000000",
    usb1: usb1 ?? "00000000",
    usb2: usb2 ?? "00000000",
    usb3: usb3 ?? "00000000",
    csb0: csb0 ?? "00000000",
    csb1: csb1 ?? "00000000",
  };
}

function readEmbed(
  fEl: Element,
  rels: Map<string, string>,
): FontDeclaration["embed"] | null {
  const slots: Array<["regular" | "bold" | "italic" | "boldItalic", string]> = [
    ["regular", "embedRegular"],
    ["bold", "embedBold"],
    ["italic", "embedItalic"],
    ["boldItalic", "embedBoldItalic"],
  ];
  const out: NonNullable<FontDeclaration["embed"]> = {};
  let any = false;
  for (const [key, tag] of slots) {
    const el = wFirst(fEl, tag);
    if (!el) continue;
    const ref = readEmbedRef(el, rels);
    if (ref) {
      out[key] = ref;
      any = true;
    }
  }
  return any ? out : null;
}

function readEmbedRef(
  embedEl: Element,
  rels: Map<string, string>,
): FontEmbedRef | null {
  const rid =
    embedEl.getAttributeNS(NS.r, "id") ?? embedEl.getAttribute("r:id");
  if (!rid) return null;
  const target = rels.get(rid);
  if (!target) return null;
  const partPath = target.startsWith("word/") ? target : `word/${target}`;
  const ref: FontEmbedRef = { partPath };
  const fontKey =
    embedEl.getAttributeNS(NS.w, "fontKey") ??
    embedEl.getAttribute("w:fontKey");
  if (fontKey) ref.fontKey = fontKey;
  const subsetted =
    embedEl.getAttributeNS(NS.w, "subsetted") ??
    embedEl.getAttribute("w:subsetted");
  if (subsetted === "true" || subsetted === "1") ref.subsetted = true;
  return ref;
}

/**
 * Convenience: parse direct-child `<w:font>` elements, in case some
 * producers use children rather than descendants. Reserved for future
 * "strict mode" callers.
 */
export function readChildFonts(parent: Element): Element[] {
  return wChildren(parent, "font");
}
