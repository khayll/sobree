import type {
  HeaderFooterRef,
  SectionColumn,
  SectionColumns,
  SectionProperties,
} from "../../doc/types";
import type { PageZoneText } from "../../paperStack/pageSetup";
import { NS } from "../shared/namespaces";
import { parseXml, wAll, wChildren, wFirst, wVal } from "../shared/xml";
import { parseRels } from "./rels";

/** Zone text extracted from the docx, with `{page}`/`{pages}` placeholders. */
export interface ImportedZones {
  header: PageZoneText;
  footer: PageZoneText;
}

interface Reference {
  type: "default" | "first" | "even";
  relId: string;
}

/**
 * Resolve header/footer references in the body's first `<w:sectPr>`, load
 * each referenced part, and flatten to plain text with `{page}` / `{pages}`
 * substituted. Returns Sobree's `PageZoneText` model.
 *
 * Phase 2 ignores "even" references and keeps only "default" and "first".
 * "Different last page" has no native Word equivalent; we leave
 * `differentLast` off.
 */
export function readHeadersAndFooters(
  bodyXml: Document,
  relsXml: string | undefined,
  textParts: Record<string, string>,
): ImportedZones {
  const defaults: PageZoneText = emptyZone();
  const zones: ImportedZones = { header: emptyZone(), footer: emptyZone() };

  const sectPr = wFirst(bodyXml, "sectPr");
  if (!sectPr) return zones;

  const titlePg = wFirst(sectPr, "titlePg") !== null;

  const headerRefs = collectReferences(sectPr, "headerReference");
  const footerRefs = collectReferences(sectPr, "footerReference");

  // Without the rels file we can't resolve any reference. Return empties.
  const rels = relsXml ? parseRels(relsXml) : new Map<string, string>();

  zones.header = resolveZone(headerRefs, rels, textParts, titlePg) ?? defaults;
  zones.footer = resolveZone(footerRefs, rels, textParts, titlePg) ?? defaults;
  return zones;
}

function collectReferences(sectPr: Element, localName: string): Reference[] {
  const out: Reference[] = [];
  for (const ref of wChildren(sectPr, localName)) {
    const type = (ref.getAttributeNS(NS.w, "type") ?? ref.getAttribute("w:type") ?? "default") as
      | "default"
      | "first"
      | "even";
    const relId =
      ref.getAttributeNS(NS.r, "id") ?? ref.getAttribute("r:id") ?? ref.getAttribute("id");
    if (relId) out.push({ type, relId });
  }
  return out;
}

function resolveZone(
  refs: Reference[],
  rels: Map<string, string>,
  parts: Record<string, string>,
  differentFirst: boolean,
): PageZoneText | null {
  const result: PageZoneText = emptyZone();
  result.differentFirst = differentFirst;

  for (const ref of refs) {
    if (ref.type === "even") continue; // Phase 2 scope cut.
    const target = rels.get(ref.relId);
    if (!target) continue;
    const path = resolveRelPath(target);
    const xml = parts[path];
    if (!xml) continue;
    const text = flattenZone(xml);
    if (ref.type === "first") result.first = text;
    else result.default = text;
  }
  // Only return the zone if we found at least one reference; otherwise let
  // the caller fall back to an empty default.
  return result.default || result.first ? result : null;
}

/**
 * `header*.xml` / `footer*.xml` → plain text with `{page}` / `{pages}`
 * substituted for Word field codes. Flat text only; paragraph breaks
 * become `\n`, inline formatting is dropped. Paired with
 * `templateToBlocks` for the AST round-trip — the bridge converts the
 * `{page}` tokens back into native `FieldRun` nodes.
 */
export function flattenZone(xml: string): string {
  const doc = parseXml(xml);
  // OOXML uses `mc:AlternateContent` to provide both a modern
  // representation (`mc:Choice Requires="..."`) AND a legacy
  // `mc:Fallback`. Without stripping Fallback, `wAll(doc, "p")`
  // returns paragraphs from BOTH branches and the text duplicates
  // in the header/footer body. Per ECMA-376 §23.2 the consumer
  // should pick one branch; we pick Choice (the modern one).
  removeMcFallbacks(doc);
  const lines: string[] = [];
  // Iterate direct `<w:p>` descendants of the root to preserve paragraph
  // breaks.
  const paragraphs = wAll(doc, "p");
  for (const p of paragraphs) {
    lines.push(flattenParagraphText(p));
  }
  return lines
    .filter((line, i) => i === 0 || line.length > 0)
    .join("\n")
    .trim();
}

/**
 * Strip every `<mc:Fallback>` element from the document tree. Used by
 * `flattenZone` so paragraphs inside the AlternateContent fallback
 * don't get walked alongside the Choice branch and duplicate text.
 * Idempotent + safe on docs with no AlternateContent.
 */
function removeMcFallbacks(doc: Document): void {
  const MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006";
  // getElementsByTagNameNS returns a live HTMLCollection — snapshot
  // into an array before removing so the iteration isn't disturbed.
  const fallbacks = Array.from(doc.getElementsByTagNameNS(MC_NS, "Fallback"));
  for (const f of fallbacks) f.parentNode?.removeChild(f);
}

function flattenParagraphText(p: Element): string {
  let out = "";
  // Walk children in document order. Handle `<w:r>` + `<w:fldSimple>`
  // + `<w:fldChar>` / `<w:instrText>` for PAGE / NUMPAGES.
  //
  // OOXML complex fields look like:
  //   <w:fldChar fldCharType="begin"/>
  //   <w:instrText>PAGE</w:instrText>
  //   <w:fldChar fldCharType="separate"/>
  //   <w:t>2</w:t>           ← cached display value (last evaluated by Word)
  //   <w:fldChar fldCharType="end"/>
  //
  // We need to skip the cached display — otherwise it leaks into the
  // template as literal text adjacent to the field token, producing
  // gibberish like "21. / 44. oldal" at render time. The instruction
  // comes from `<w:instrText>`; everything between `separate` and
  // `end` is the cache and gets dropped.
  let inField = false;
  let instrBuf = "";
  for (const child of Array.from(p.childNodes)) {
    if (!(child instanceof Element) || child.namespaceURI !== NS.w) continue;
    if (child.localName === "r") {
      for (const sub of Array.from(child.childNodes)) {
        if (!(sub instanceof Element) || sub.namespaceURI !== NS.w) continue;
        if (sub.localName === "t") {
          if (!inField) out += sub.textContent ?? "";
          // else: cached field display — skip.
        } else if (sub.localName === "br") {
          if (!inField) out += "\n";
        } else if (sub.localName === "fldChar") {
          const type = sub.getAttributeNS(NS.w, "fldCharType") ?? sub.getAttribute("w:fldCharType");
          if (type === "begin") {
            inField = true;
            instrBuf = "";
          } else if (type === "end") {
            if (inField) out += fieldToToken(instrBuf);
            inField = false;
            instrBuf = "";
          }
          // `separate` is implicit — we already skip <w:t> while inField.
        } else if (sub.localName === "instrText" && inField) {
          instrBuf += sub.textContent ?? "";
        }
      }
    } else if (child.localName === "fldSimple") {
      const instr = child.getAttributeNS(NS.w, "instr") ?? child.getAttribute("w:instr") ?? "";
      out += fieldToToken(instr);
    }
  }
  return out;
}

function fieldToToken(instr: string): string {
  const trimmed = instr.trim().toUpperCase();
  if (trimmed === "PAGE") return "{page}";
  if (trimmed === "NUMPAGES") return "{pages}";
  return "";
}

function resolveRelPath(target: string): string {
  // Relationships in word/_rels/document.xml.rels use paths relative to
  // word/. Headers and footers live at `word/header1.xml` etc.
  if (target.startsWith("/")) return target.slice(1);
  return `word/${target}`;
}

function emptyZone(): PageZoneText {
  return { default: "", first: "", last: "", differentFirst: false, differentLast: false };
}

/** Read a twip-valued attribute off `<w:pgSz>` / `<w:pgMar>`. */
export function readTwipsAttr(el: Element | null, name: string): number | null {
  if (!el) return null;
  const v = el.getAttributeNS(NS.w, name) ?? el.getAttribute(`w:${name}`);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convert a `<w:sectPr>` Element into a fully-populated `SectionProperties`.
 *
 * Reads pgSz / pgMar / vAlign / titlePg / type plus header and footer
 * references (resolved through `rels` to partIds). Falls back to A4
 * portrait + 1" margins when geometry is missing — matches Word's
 * behaviour when an imported sectPr is sparse.
 */
export function readSection(sectPr: Element, rels: Map<string, string>): SectionProperties {
  const pgSz = wFirst(sectPr, "pgSz");
  const pgMar = wFirst(sectPr, "pgMar");
  const vAlignVal = wVal(wFirst(sectPr, "vAlign"));
  const typeVal = wVal(wFirst(sectPr, "type"));
  const orientAttr = pgSz?.getAttributeNS(NS.w, "orient") ?? pgSz?.getAttribute("w:orient") ?? null;
  const wTwips = readTwipsAttr(pgSz, "w") ?? 11906; // A4 default
  const hTwips = readTwipsAttr(pgSz, "h") ?? 16838;

  const section: SectionProperties = {
    pageSize: {
      wTwips,
      hTwips,
      orientation: orientAttr === "landscape" ? "landscape" : "portrait",
    },
    pageMargins: {
      topTwips: readTwipsAttr(pgMar, "top") ?? 1440,
      rightTwips: readTwipsAttr(pgMar, "right") ?? 1440,
      bottomTwips: readTwipsAttr(pgMar, "bottom") ?? 1440,
      leftTwips: readTwipsAttr(pgMar, "left") ?? 1440,
      headerTwips: readTwipsAttr(pgMar, "header") ?? 720,
      footerTwips: readTwipsAttr(pgMar, "footer") ?? 720,
      gutterTwips: readTwipsAttr(pgMar, "gutter") ?? 0,
    },
    headerRefs: collectHeaderFooterRefs(sectPr, "headerReference", rels),
    footerRefs: collectHeaderFooterRefs(sectPr, "footerReference", rels),
  };

  if (
    vAlignVal === "top" ||
    vAlignVal === "center" ||
    vAlignVal === "bottom" ||
    vAlignVal === "both"
  ) {
    section.vAlign = vAlignVal;
  }
  if (wFirst(sectPr, "titlePg")) section.titlePage = true;
  if (
    typeVal === "continuous" ||
    typeVal === "nextPage" ||
    typeVal === "evenPage" ||
    typeVal === "oddPage"
  ) {
    section.type = typeVal;
  }

  // <w:cols w:num="2" w:space="708"/> — multi-column section layout.
  // Only emit when `num > 1`; the default single-column case is
  // represented by `columns` being absent.
  const cols = wFirst(sectPr, "cols");
  if (cols) {
    const num = readTwipsAttr(cols, "num") ?? 1; // `num` reuses the same attribute reader; it's just an integer.
    if (num > 1) {
      const sectionCols: SectionColumns = { count: num };
      const space = readTwipsAttr(cols, "space");
      if (space !== null && space > 0) sectionCols.spaceTwips = space;
      // Unequal columns: `w:equalWidth="0"` plus one `<w:col w:w w:space>`
      // per column. Only take this path when BOTH the flag is explicitly
      // off AND a full set of `<w:col>` widths is present — a stray
      // partial set or `equalWidth="1"` stays on the equal (CSS) path.
      const equalWidthAttr =
        cols.getAttributeNS(NS.w, "equalWidth") ?? cols.getAttribute("w:equalWidth");
      if (equalWidthAttr === "0" || equalWidthAttr === "false") {
        const colEls = wChildren(cols, "col");
        const perCol: SectionColumn[] = [];
        for (const col of colEls) {
          const w = readTwipsAttr(col, "w");
          if (w === null || w <= 0) continue;
          const colSpace = readTwipsAttr(col, "space");
          perCol.push(
            colSpace !== null && colSpace > 0
              ? { widthTwips: w, spaceTwips: colSpace }
              : { widthTwips: w },
          );
        }
        if (perCol.length === num) {
          sectionCols.equalWidth = false;
          sectionCols.columns = perCol;
        }
      }
      section.columns = sectionCols;
    }
  }

  return section;
}

function collectHeaderFooterRefs(
  sectPr: Element,
  localName: "headerReference" | "footerReference",
  rels: Map<string, string>,
): HeaderFooterRef[] {
  const out: HeaderFooterRef[] = [];
  for (const ref of wChildren(sectPr, localName)) {
    const typeAttr = ref.getAttributeNS(NS.w, "type") ?? ref.getAttribute("w:type") ?? "default";
    const relId = ref.getAttributeNS(NS.r, "id") ?? ref.getAttribute("r:id");
    if (!relId) continue;
    const target = rels.get(relId);
    if (!target) continue;
    if (typeAttr === "default" || typeAttr === "first" || typeAttr === "even") {
      // partId is the relationship target stripped of the `word/` prefix
      // (rels store paths relative to the document part).
      out.push({ type: typeAttr, partId: target.replace(/^word\//, "") });
    }
  }
  return out;
}

/** Shared helper: parse `<w:sectPr>` for pgSz/pgMar/vAlign. */
export function readPageGeometry(xmlDoc: Document): {
  widthTwips: number | null;
  heightTwips: number | null;
  margins: { top: number | null; right: number | null; bottom: number | null; left: number | null };
  vAlign: "top" | "center" | "bottom" | "both" | null;
} | null {
  const sectPr = wFirst(xmlDoc, "sectPr");
  if (!sectPr) return null;
  const pgSz = wFirst(sectPr, "pgSz");
  const pgMar = wFirst(sectPr, "pgMar");
  const vAlignEl = wFirst(sectPr, "vAlign");
  const vAlignVal = vAlignEl ? wVal(vAlignEl) : null;
  return {
    widthTwips: readTwipsAttr(pgSz, "w"),
    heightTwips: readTwipsAttr(pgSz, "h"),
    margins: {
      top: readTwipsAttr(pgMar, "top"),
      right: readTwipsAttr(pgMar, "right"),
      bottom: readTwipsAttr(pgMar, "bottom"),
      left: readTwipsAttr(pgMar, "left"),
    },
    vAlign:
      vAlignVal === "top" ||
      vAlignVal === "center" ||
      vAlignVal === "bottom" ||
      vAlignVal === "both"
        ? vAlignVal
        : null,
  };
}

// Re-export `wVal` so callers don't import from both modules.
export { wVal };
