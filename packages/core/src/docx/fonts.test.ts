/**
 * End-to-end font tests:
 *   - import: fontTable.xml + obfuscated font part → FontDeclaration
 *     with embed.regular pointing into rawParts.
 *   - export: doc.fonts → fontTable.xml + relationships + content-type
 *     overrides + .odttf parts retained.
 *   - round-trip: import then export of a synthetic .docx preserves
 *     the font declaration shape.
 */
import { afterEach, describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import { emptyDocument } from "../doc/builders";
import type { FontDeclaration } from "../doc/types";
import { exportDocx } from "./export/index";
import { importDocx } from "./import/index";
import { obfuscate } from "../fonts/odttf";

const TEXT = new TextEncoder();

/** Build a 64-byte synthetic font payload for round-trip tests. */
function syntheticFontBytes(): Uint8Array {
  const out = new Uint8Array(64);
  for (let i = 0; i < 64; i++) out[i] = i & 0xff;
  return out;
}

const SAMPLE_KEY = "{302EE813-EB4A-4642-A93A-89EF99B2457E}";

/**
 * Build the smallest possible .docx with:
 *   - one paragraph containing the word "Hello".
 *   - a fontTable.xml declaring "TestFont" with one embedRegular
 *     referencing word/fonts/font1.odttf.
 *   - the obfuscated synthetic font bytes at that path.
 *
 * Skips a real OS/2 table — these tests don't exercise fsType.
 */
function buildFontDocx(): Uint8Array {
  const documentXml = TEXT.encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body>
</w:document>`,
  );
  const documentRels = TEXT.encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>
</Relationships>`,
  );
  const fontTable = TEXT.encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
         xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:font w:name="TestFont">
    <w:panose1 w:val="020B0604020202020204"/>
    <w:family w:val="swiss"/>
    <w:pitch w:val="variable"/>
    <w:embedRegular r:id="rIdF1" w:fontKey="${SAMPLE_KEY}"/>
  </w:font>
</w:fonts>`,
  );
  const fontTableRels = TEXT.encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdF1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font1.odttf"/>
</Relationships>`,
  );
  const contentTypes = TEXT.encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>
</Types>`,
  );
  const rootRels = TEXT.encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  const odttf = obfuscate(syntheticFontBytes(), SAMPLE_KEY);

  return zipSync({
    "[Content_Types].xml": contentTypes,
    "_rels/.rels": rootRels,
    "word/document.xml": documentXml,
    "word/_rels/document.xml.rels": documentRels,
    "word/fontTable.xml": fontTable,
    "word/_rels/fontTable.xml.rels": fontTableRels,
    "word/fonts/font1.odttf": odttf,
  });
}

describe("import — fontTable.xml", () => {
  it("parses a single embedRegular declaration into doc.fonts", async () => {
    const bytes = buildFontDocx();
    const { document: doc } = await importDocx(bytes);
    expect(doc.fonts).toHaveLength(1);
    const f = doc.fonts[0]!;
    expect(f.name).toBe("TestFont");
    expect(f.panose).toBe("020B0604020202020204");
    expect(f.family).toBe("swiss");
    expect(f.embed?.regular?.partPath).toBe("word/fonts/font1.odttf");
    expect(f.embed?.regular?.fontKey).toBe(SAMPLE_KEY);
  });

  it("preserves the obfuscated font bytes in rawParts", async () => {
    const bytes = buildFontDocx();
    const { document: doc } = await importDocx(bytes);
    const part = doc.rawParts["word/fonts/font1.odttf"];
    expect(part).toBeDefined();
    expect(part).toEqual(obfuscate(syntheticFontBytes(), SAMPLE_KEY));
  });
});

describe("export — fontTable emission", () => {
  it("emits fontTable.xml + relationships + content-type when doc.fonts isn't empty", () => {
    const doc = emptyDocument();
    const fontPath = "word/fonts/font1.odttf";
    doc.rawParts[fontPath] = obfuscate(syntheticFontBytes(), SAMPLE_KEY);
    doc.fonts.push({
      name: "TestFont",
      embed: {
        regular: { partPath: fontPath, fontKey: SAMPLE_KEY },
      },
    });
    const { bytes } = exportDocx(doc);
    const files = unzipSync(bytes);
    const fontTableXml = new TextDecoder().decode(files["word/fontTable.xml"]!);
    expect(fontTableXml).toContain('w:name="TestFont"');
    expect(fontTableXml).toContain("w:embedRegular");
    expect(fontTableXml).toContain(SAMPLE_KEY);

    const fontTableRelsXml = new TextDecoder().decode(
      files["word/_rels/fontTable.xml.rels"]!,
    );
    expect(fontTableRelsXml).toContain('Target="fonts/font1.odttf"');

    expect(files["word/fonts/font1.odttf"]).toEqual(doc.rawParts[fontPath]);

    const contentTypesXml = new TextDecoder().decode(files["[Content_Types].xml"]!);
    expect(contentTypesXml).toContain("/word/fontTable.xml");
    expect(contentTypesXml).toContain("obfuscatedFont");
    expect(contentTypesXml).toContain('Extension="odttf"');

    const documentRelsXml = new TextDecoder().decode(
      files["word/_rels/document.xml.rels"]!,
    );
    expect(documentRelsXml).toContain("fontTable.xml");
    expect(documentRelsXml).toContain("/relationships/fontTable");
  });

  it("does not emit fontTable parts for a doc with no fonts", () => {
    const doc = emptyDocument();
    const { bytes } = exportDocx(doc);
    const files = unzipSync(bytes);
    expect(files["word/fontTable.xml"]).toBeUndefined();
    expect(files["word/_rels/fontTable.xml.rels"]).toBeUndefined();
  });
});

describe("round-trip — import then export preserves fonts", () => {
  it("survives one full import/export cycle", async () => {
    const inputBytes = buildFontDocx();
    const { document: doc } = await importDocx(inputBytes);
    const { bytes } = exportDocx(doc);
    const files = unzipSync(bytes);
    expect(files["word/fontTable.xml"]).toBeDefined();
    expect(files["word/fonts/font1.odttf"]).toEqual(
      doc.rawParts["word/fonts/font1.odttf"],
    );
  });
});

describe("Editor.embedFont", () => {
  let cleanup: (() => void)[] = [];
  afterEach(() => {
    for (const c of cleanup.splice(0)) c();
  });

  function buildOS2WithFsType(fsType: number): Uint8Array {
    const buf = new ArrayBuffer(40);
    const v = new DataView(buf);
    v.setUint32(0, 0x00010000); // sfnt version (TrueType)
    v.setUint16(4, 1); // numTables
    v.setUint32(12, 0x4f532f32); // "OS/2"
    v.setUint32(20, 28); // table offset
    v.setUint32(24, 10); // length
    v.setUint16(36, fsType);
    return new Uint8Array(buf);
  }

  it("embeds an installable font and adds a declaration", async () => {
    const { Editor } = await import("../editor/index");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new Editor(host);
    cleanup.push(() => {
      editor.destroy();
      host.remove();
    });
    const result = editor.embedFont("TestFace", {
      regular: buildOS2WithFsType(0x0000),
    });
    expect(result.warnings).toEqual([]);
    const doc = editor.getDocument();
    expect(doc.fonts).toHaveLength(1);
    const decl = doc.fonts[0] as FontDeclaration;
    expect(decl.name).toBe("TestFace");
    expect(decl.embed?.regular?.partPath).toMatch(/^word\/fonts\/font\d+\.odttf$/);
    expect(decl.embed?.regular?.fontKey).toMatch(
      /^\{[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\}$/,
    );
    // Bytes should be obfuscated (not equal to the input).
    const stored = doc.rawParts[decl.embed!.regular!.partPath];
    expect(stored).toBeDefined();
    expect(stored).not.toEqual(buildOS2WithFsType(0x0000));
  });

  it("refuses a restricted font and reports a warning", async () => {
    const { Editor } = await import("../editor/index");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new Editor(host);
    cleanup.push(() => {
      editor.destroy();
      host.remove();
    });
    const result = editor.embedFont("NopeFace", {
      regular: buildOS2WithFsType(0x0002), // restricted
    });
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("NopeFace");
    expect(editor.getDocument().fonts).toHaveLength(0);
  });

  it("removeEmbeddedFont drops the declaration", async () => {
    const { Editor } = await import("../editor/index");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new Editor(host);
    cleanup.push(() => {
      editor.destroy();
      host.remove();
    });
    editor.embedFont("Wibble", { regular: buildOS2WithFsType(0x0000) });
    expect(editor.getDocument().fonts).toHaveLength(1);
    editor.removeEmbeddedFont("Wibble");
    expect(editor.getDocument().fonts).toHaveLength(0);
  });
});
