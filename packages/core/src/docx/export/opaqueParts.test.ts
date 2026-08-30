import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { importDocx } from "../import/index";
import { exportDocx } from "./index";

const TEXT = new TextEncoder();

/**
 * Opaque part pass-through: settings / webSettings / theme / docProps /
 * customXml survive export BYTE-identical, with the document-level and
 * package-level relationships plus content types each part requires.
 * (The export fixpoint enforces this corpus-wide; these fixtures pin
 * the rels/content-type wiring on a minimal package.)
 */
const SETTINGS = `<?xml version="1.0"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/><w:evenAndOddHeaders/></w:settings>`;
const THEME = `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements/></a:theme>`;
const CORE = `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Kept</dc:title></cp:coreProperties>`;
const CUSTOM_ITEM = `<?xml version="1.0"?><data>bound</data>`;
const CUSTOM_PROPS = `<?xml version="1.0"?><ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="{X}"/>`;

function buildDocx(): Uint8Array {
  return zipSync({
    "[Content_Types].xml": TEXT.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    ),
    "_rels/.rels": TEXT.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    ),
    "word/document.xml": TEXT.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>body</w:t></w:r></w:p></w:body>
</w:document>`,
    ),
    "word/settings.xml": TEXT.encode(SETTINGS),
    "word/theme/theme1.xml": TEXT.encode(THEME),
    "docProps/core.xml": TEXT.encode(CORE),
    "customXml/item1.xml": TEXT.encode(CUSTOM_ITEM),
    "customXml/itemProps1.xml": TEXT.encode(CUSTOM_PROPS),
  });
}

describe("opaque part pass-through", () => {
  it("re-emits settings/theme/docProps/customXml byte-identical with rels + content types", async () => {
    const { document: doc } = await importDocx(buildDocx());
    const parts = unzipSync(exportDocx(doc).bytes);
    const dec = new TextDecoder();

    expect(dec.decode(parts["word/settings.xml"])).toBe(SETTINGS);
    expect(dec.decode(parts["word/theme/theme1.xml"])).toBe(THEME);
    expect(dec.decode(parts["docProps/core.xml"])).toBe(CORE);
    expect(dec.decode(parts["customXml/item1.xml"])).toBe(CUSTOM_ITEM);
    expect(dec.decode(parts["customXml/itemProps1.xml"])).toBe(CUSTOM_PROPS);

    const docRels = dec.decode(parts["word/_rels/document.xml.rels"]);
    expect(docRels).toContain('Target="settings.xml"');
    expect(docRels).toContain('Target="theme/theme1.xml"');
    expect(docRels).toContain('Target="../customXml/item1.xml"');

    const rootRels = dec.decode(parts["_rels/.rels"]);
    expect(rootRels).toContain('Target="docProps/core.xml"');
    expect(rootRels).toContain("core-properties");

    const ct = dec.decode(parts["[Content_Types].xml"]);
    expect(ct).toContain("wordprocessingml.settings+xml");
    expect(ct).toContain("officedocument.theme+xml");
    expect(ct).toContain("core-properties+xml");
    expect(ct).toContain("customXmlProperties+xml");
  });

  it("stays at the fixpoint through a second export cycle", async () => {
    const { document: doc } = await importDocx(buildDocx());
    const once = exportDocx(doc).bytes;
    const { document: doc2 } = await importDocx(once);
    const twice = exportDocx(doc2).bytes;
    const p1 = unzipSync(once);
    const p2 = unzipSync(twice);
    for (const path of ["word/settings.xml", "word/theme/theme1.xml", "docProps/core.xml"]) {
      expect(Buffer.from(p2[path] ?? []).equals(Buffer.from(p1[path] ?? []))).toBe(true);
    }
  });

  it("emits nothing extra for a from-scratch document", async () => {
    const { emptyDocument, paragraph, text } = await import("../../doc/builders");
    const doc = emptyDocument();
    doc.body = [paragraph([text("fresh")])];
    const parts = unzipSync(exportDocx(doc).bytes);
    expect(parts["word/settings.xml"]).toBeUndefined();
    expect(parts["word/theme/theme1.xml"]).toBeUndefined();
    expect(parts["docProps/core.xml"]).toBeUndefined();
    const rootRels = new TextDecoder().decode(parts["_rels/.rels"]);
    expect(rootRels.match(/<Relationship /g)?.length).toBe(1);
  });
});
