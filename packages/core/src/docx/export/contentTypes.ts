import { NS } from "../shared/namespaces";
import { el, xmlDocument } from "../shared/xml";

const REL_TYPES = {
  header: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header",
  footer: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer",
  image: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  hyperlink: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
  fontTable: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable",
  numbering: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
  font: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font",
} as const;

type RelKind = keyof typeof REL_TYPES;

/**
 * `[Content_Types].xml` tells Office which content-type handler to use for
 * each part. `overrides` are appended to the baseline; `imageExtensions`
 * become `<Default>` content-type entries so embedded media round-trips.
 */
export function renderContentTypesXml(
  overrides: Array<{ partName: string; contentType: string }> = [],
  imageExtensions: readonly string[] = [],
): string {
  const base = [
    el("Default", {
      Extension: "rels",
      ContentType: "application/vnd.openxmlformats-package.relationships+xml",
    }),
    el("Default", { Extension: "xml", ContentType: "application/xml" }),
  ];

  const seen = new Set<string>();
  for (const ext of imageExtensions) {
    if (seen.has(ext)) continue;
    seen.add(ext);
    base.push(
      el("Default", {
        Extension: ext,
        ContentType: imageMimeFromExtension(ext),
      }),
    );
  }

  base.push(
    el("Override", {
      PartName: "/word/document.xml",
      ContentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    }),
    el("Override", {
      PartName: "/word/styles.xml",
      ContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
    }),
  );

  const extra = overrides.map((o) =>
    el("Override", { PartName: o.partName, ContentType: o.contentType }),
  );
  return xmlDocument(el("Types", { xmlns: NS.ct }, [...base, ...extra]));
}

/**
 * `_rels/.rels` — the package-level relationships, pointing at the main
 * document part.
 */
export function renderRootRelsXml(): string {
  const children = [
    el("Relationship", {
      Id: "rId1",
      Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
      Target: "word/document.xml",
    }),
  ];
  return xmlDocument(el("Relationships", { xmlns: NS.rel }, children));
}

/**
 * `word/_rels/document.xml.rels` — relationships originating from
 * `document.xml`. Always includes the styles relationship (`rId1`);
 * callers pass additional header/footer/image relationships to append.
 */
export function renderDocumentRelsXml(
  extras: Array<{ id: string; type: RelKind; target: string; external?: boolean }> = [],
): string {
  const stylesRel = el("Relationship", {
    Id: "rId1",
    Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
    Target: "styles.xml",
  });
  const extraRels = extras.map((e) => {
    const attrs: Record<string, string | undefined> = {
      Id: e.id,
      Type: REL_TYPES[e.type],
      Target: e.target,
    };
    if (e.external) attrs.TargetMode = "External";
    return el("Relationship", attrs);
  });
  return xmlDocument(el("Relationships", { xmlns: NS.rel }, [stylesRel, ...extraRels]));
}

function imageMimeFromExtension(ext: string): string {
  const lower = ext.toLowerCase();
  if (lower === "png") return "image/png";
  if (lower === "jpg" || lower === "jpeg") return "image/jpeg";
  if (lower === "gif") return "image/gif";
  if (lower === "webp") return "image/webp";
  if (lower === "svg") return "image/svg+xml";
  if (lower === "bmp") return "image/bmp";
  // OOXML embedded fonts — obfuscated TrueType/OpenType.
  if (lower === "odttf") return "application/vnd.openxmlformats-officedocument.obfuscatedFont";
  // Bare TTF/OTF (rare for embedded — Word always obfuscates).
  if (lower === "ttf") return "application/x-font-ttf";
  if (lower === "otf") return "application/x-font-otf";
  return "application/octet-stream";
}
