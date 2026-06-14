import type { ExportContext } from "./context";
import { renderBlocks } from "./document";
import { NS } from "../shared/namespaces";
import { el, xmlDocument } from "../shared/xml";
import type {
  Block,
  HeaderFooterRef,
  SectionColumns,
  SectionProperties,
  SobreeDocument,
} from "../../doc/types";

const HEADER_CT =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml";
const FOOTER_CT =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml";

/**
 * Build the OOXML scaffolding for every section in `doc`: header/footer
 * XML parts, relationships, content-type overrides — and a parallel
 * array of `<w:sectPr>` XML strings, one per section.
 *
 * Mutates `ctx`. Each referenced header/footer appends to `ctx.parts`,
 * `ctx.relationships`, and `ctx.contentTypeOverrides`. Returns the
 * sectPr XMLs in section order so the body renderer can splice the
 * non-final ones into the last paragraph of each section's range and
 * place the final one at body level.
 *
 * Header/footer parts are deduped across sections by their `partId`:
 * the same `header1.xml` referenced from two sections only emits one
 * part, with one `rId`. Subsequent references reuse the existing rId.
 */
export function emitHeadersAndFooters(doc: SobreeDocument, ctx: ExportContext): string[] {
  if (doc.sections.length === 0) return [renderSectPrFallback()];

  // Cache: partId → rId so a header shared across sections gets one rId.
  const partIdToRid = new Map<string, string>();

  const emitForSection = (section: SectionProperties): string => {
    const headerRefXml: string[] = [];
    const footerRefXml: string[] = [];

    const emit = (ref: HeaderFooterRef, kind: "header" | "footer"): void => {
      if (ref.type === "even") return; // Scope cut.
      const body = doc.headerFooterBodies[ref.partId] ?? [];
      if (body.length === 0) return;
      let id = partIdToRid.get(ref.partId);
      if (!id) {
        const path = `word/${ref.partId}`;
        ctx.parts[path] = renderHeaderFooterXml(kind, body, ctx, doc);
        ctx.contentTypeOverrides.push({
          partName: `/${path}`,
          contentType: kind === "header" ? HEADER_CT : FOOTER_CT,
        });
        id = `rId${ctx.nextRid++}`;
        ctx.relationships.push({ id, type: kind, target: ref.partId });
        partIdToRid.set(ref.partId, id);
      }
      const refTag = kind === "header" ? "w:headerReference" : "w:footerReference";
      const xml = el(refTag, { "w:type": ref.type, "r:id": id });
      if (kind === "header") headerRefXml.push(xml);
      else footerRefXml.push(xml);
    };

    for (const ref of section.headerRefs) emit(ref, "header");
    for (const ref of section.footerRefs) emit(ref, "footer");

    return renderSectPr(section, headerRefXml, footerRefXml);
  };

  return doc.sections.map(emitForSection);
}

function renderHeaderFooterXml(
  kind: "header" | "footer",
  body: readonly Block[],
  ctx: ExportContext,
  doc: SobreeDocument,
): string {
  const rootTag = kind === "header" ? "w:hdr" : "w:ftr";
  const children = renderBlocks(body, ctx, doc);
  // Word refuses to open hdr/ftr parts without at least one paragraph.
  if (children.length === 0) children.push(el("w:p"));
  return xmlDocument(el(rootTag, { "xmlns:w": NS.w, "xmlns:r": NS.r }, children));
}

export function renderSectPr(
  section: SectionProperties,
  headerRefs: string[],
  footerRefs: string[],
): string {
  const children: string[] = [];
  children.push(...headerRefs, ...footerRefs);
  // `<w:type>` lives between header/footer refs and pgSz per the
  // CT_SectPr child order. Default is `nextPage` — only emit when the
  // section explicitly carries a different break type.
  if (section.type && section.type !== "nextPage") {
    children.push(el("w:type", { "w:val": section.type }));
  } else if (section.type === "nextPage") {
    // Word writes `<w:type w:val="nextPage"/>` explicitly when the
    // section was created with a section break — emit it so round-trip
    // metadata is preserved for downstream tools.
    children.push(el("w:type", { "w:val": "nextPage" }));
  }
  children.push(
    el("w:pgSz", {
      "w:w": section.pageSize.wTwips,
      "w:h": section.pageSize.hTwips,
      ...(section.pageSize.orientation === "landscape" ? { "w:orient": "landscape" } : {}),
    }),
  );
  children.push(
    el("w:pgMar", {
      "w:top": section.pageMargins.topTwips,
      "w:right": section.pageMargins.rightTwips,
      "w:bottom": section.pageMargins.bottomTwips,
      "w:left": section.pageMargins.leftTwips,
      "w:header": section.pageMargins.headerTwips,
      "w:footer": section.pageMargins.footerTwips,
      "w:gutter": section.pageMargins.gutterTwips,
    }),
  );
  // `<w:cols>` sits between pgMar and vAlign in CT_SectPr order
  // (ECMA-376 §17.6.17). Emit only for multi-column sections; the
  // single-column default is the absence of the element.
  const cols = renderCols(section.columns);
  if (cols) children.push(cols);
  // OOXML omits `<w:vAlign>` for the default `top` value; emit only the
  // distinguished cases. See ECMA-376 §17.6.21.
  if (section.vAlign && section.vAlign !== "top") {
    children.push(el("w:vAlign", { "w:val": section.vAlign }));
  }
  if (section.titlePage) children.push(el("w:titlePg"));
  return el("w:sectPr", null, children);
}

/**
 * `<w:cols>` for a multi-column section. Equal columns emit just
 * `num` + `space`; unequal columns (`equalWidth=false` with per-column
 * widths) emit `equalWidth="0"` plus one `<w:col w:w w:space>` per
 * column — the inverse of the importer in `import/headers.ts`. Returns
 * `null` for single-column (or absent) sections so the caller omits it.
 */
function renderCols(columns: SectionColumns | undefined): string | null {
  if (!columns || columns.count <= 1) return null;
  const attrs: Record<string, string | number | undefined> = { "w:num": columns.count };
  if (columns.spaceTwips !== undefined) attrs["w:space"] = columns.spaceTwips;
  if (columns.equalWidth === false && columns.columns?.length === columns.count) {
    attrs["w:equalWidth"] = "0";
    const colEls = columns.columns.map((c) =>
      el("w:col", {
        "w:w": c.widthTwips,
        ...(c.spaceTwips !== undefined ? { "w:space": c.spaceTwips } : {}),
      }),
    );
    return el("w:cols", attrs, colEls);
  }
  return el("w:cols", attrs);
}

function renderSectPrFallback(): string {
  return el(
    "w:sectPr",
    null,
    `${el("w:pgSz", { "w:w": 12240, "w:h": 15840 })}${el("w:pgMar", {
      "w:top": 1440,
      "w:right": 1440,
      "w:bottom": 1440,
      "w:left": 1440,
      "w:header": 720,
      "w:footer": 720,
      "w:gutter": 0,
    })}`,
  );
}
