import { describe, expect, it } from "vitest";
import { NS } from "../shared/namespaces";
import { parseXml } from "../shared/xml";
import { renderContentTypesXml, renderDocumentRelsXml, renderRootRelsXml } from "./contentTypes";

const CT_DOCUMENT_MAIN =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const CT_STYLES = "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml";

function defaults(doc: Document): Map<string, string> {
  const out = new Map<string, string>();
  for (const el of Array.from(doc.getElementsByTagNameNS(NS.ct, "Default"))) {
    out.set(el.getAttribute("Extension")!, el.getAttribute("ContentType")!);
  }
  return out;
}

function overrides(doc: Document): Map<string, string> {
  const out = new Map<string, string>();
  for (const el of Array.from(doc.getElementsByTagNameNS(NS.ct, "Override"))) {
    out.set(el.getAttribute("PartName")!, el.getAttribute("ContentType")!);
  }
  return out;
}

describe("renderContentTypesXml", () => {
  it("emits a well-formed Types root in the content-types namespace", () => {
    const doc = parseXml(renderContentTypesXml());
    expect(doc.documentElement.localName).toBe("Types");
    expect(doc.documentElement.namespaceURI).toBe(NS.ct);
  });

  it("declares the baseline rels + xml defaults", () => {
    const def = defaults(parseXml(renderContentTypesXml()));
    expect(def.get("rels")).toBe("application/vnd.openxmlformats-package.relationships+xml");
    expect(def.get("xml")).toBe("application/xml");
  });

  it("declares document.xml and styles.xml overrides by default", () => {
    const ov = overrides(parseXml(renderContentTypesXml()));
    expect(ov.get("/word/document.xml")).toBe(CT_DOCUMENT_MAIN);
    expect(ov.get("/word/styles.xml")).toBe(CT_STYLES);
  });

  it("appends caller-provided overrides after the baseline", () => {
    const xml = renderContentTypesXml([
      { partName: "/word/header1.xml", contentType: "application/header+xml" },
    ]);
    const ov = overrides(parseXml(xml));
    expect(ov.get("/word/header1.xml")).toBe("application/header+xml");
    // Baseline overrides are still present.
    expect(ov.get("/word/document.xml")).toBe(CT_DOCUMENT_MAIN);
  });

  it("maps image extensions to their MIME content types", () => {
    const def = defaults(parseXml(renderContentTypesXml([], ["png", "jpg", "gif"])));
    expect(def.get("png")).toBe("image/png");
    expect(def.get("jpg")).toBe("image/jpeg");
    expect(def.get("gif")).toBe("image/gif");
  });

  it("falls back to octet-stream for unknown extensions", () => {
    const def = defaults(parseXml(renderContentTypesXml([], ["xyz"])));
    expect(def.get("xyz")).toBe("application/octet-stream");
  });

  it("deduplicates repeated image extensions", () => {
    const xml = renderContentTypesXml([], ["png", "png", "png"]);
    const pngCount = Array.from(parseXml(xml).getElementsByTagNameNS(NS.ct, "Default")).filter(
      (e) => e.getAttribute("Extension") === "png",
    ).length;
    expect(pngCount).toBe(1);
  });
});

describe("renderRootRelsXml", () => {
  it("emits a Relationships root in the package-relationships namespace", () => {
    const doc = parseXml(renderRootRelsXml());
    expect(doc.documentElement.localName).toBe("Relationships");
    expect(doc.documentElement.namespaceURI).toBe(NS.rel);
  });

  it("points rId1 at word/document.xml with the officeDocument type", () => {
    const doc = parseXml(renderRootRelsXml());
    const rel = doc.getElementsByTagNameNS(NS.rel, "Relationship")[0]!;
    expect(rel.getAttribute("Id")).toBe("rId1");
    expect(rel.getAttribute("Target")).toBe("word/document.xml");
    expect(rel.getAttribute("Type")).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
    );
  });
});

describe("renderDocumentRelsXml", () => {
  it("always includes the styles relationship at rId1", () => {
    const doc = parseXml(renderDocumentRelsXml());
    const rels = Array.from(doc.getElementsByTagNameNS(NS.rel, "Relationship"));
    expect(rels).toHaveLength(1);
    const styles = rels[0]!;
    expect(styles.getAttribute("Id")).toBe("rId1");
    expect(styles.getAttribute("Target")).toBe("styles.xml");
    expect(styles.getAttribute("Type")).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
    );
  });

  it("appends extra relationships with the right resolved type URI", () => {
    const xml = renderDocumentRelsXml([{ id: "rId2", type: "image", target: "media/image1.png" }]);
    const doc = parseXml(xml);
    const rels = Array.from(doc.getElementsByTagNameNS(NS.rel, "Relationship"));
    expect(rels).toHaveLength(2);
    const img = rels.find((r) => r.getAttribute("Id") === "rId2")!;
    expect(img.getAttribute("Target")).toBe("media/image1.png");
    expect(img.getAttribute("Type")).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
    );
    expect(img.getAttribute("TargetMode")).toBeNull();
  });

  it("marks external relationships with TargetMode=External", () => {
    const xml = renderDocumentRelsXml([
      { id: "rId3", type: "hyperlink", target: "https://example.com", external: true },
    ]);
    const doc = parseXml(xml);
    const link = Array.from(doc.getElementsByTagNameNS(NS.rel, "Relationship")).find(
      (r) => r.getAttribute("Id") === "rId3",
    )!;
    expect(link.getAttribute("TargetMode")).toBe("External");
    expect(link.getAttribute("Type")).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
    );
  });
});
