import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { Paragraph, TextRun } from "../doc/types";
import { exportDocx } from "./export/index";
import { importDocx } from "./import/index";

const TEXT = new TextEncoder();

/**
 * Theme font scheme resolution. Contracts pinned where hypotheses
 * diverge:
 *   - `w:asciiTheme` resolves against `<a:fontScheme>` and SUPERSEDES a
 *     literal `w:ascii` beside it (ECMA-376 §17.3.2.26 — Word leaves
 *     stale literals around because the theme wins);
 *   - the styles heading/body baselines use the theme faces, with the
 *     old hardcoded literals demoted to no-theme-part fallbacks;
 *   - export re-emits the theme linkage (resolved literal + theme attr)
 *     and the round trip reaches a fixpoint.
 */
const THEME = `<?xml version="1.0"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="T">
  <a:themeElements>
    <a:clrScheme name="c"><a:dk1><a:srgbClr val="000000"/></a:dk1></a:clrScheme>
    <a:fontScheme name="f">
      <a:majorFont><a:latin typeface="Cambria"/></a:majorFont>
      <a:minorFont><a:latin typeface="Georgia"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`;

function buildDocx(opts: { theme?: boolean; stylesXml?: string; bodyXml: string }): Uint8Array {
  const parts: Record<string, Uint8Array> = {
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
  <w:body>${opts.bodyXml}</w:body>
</w:document>`,
    ),
  };
  if (opts.theme !== false) parts["word/theme/theme1.xml"] = TEXT.encode(THEME);
  if (opts.stylesXml) parts["word/styles.xml"] = TEXT.encode(opts.stylesXml);
  return zipSync(parts);
}

const STYLES_WITH_HEADING = `<?xml version="1.0"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/></w:rPr>
  </w:style>
</w:styles>`;

describe("theme font scheme", () => {
  it("resolves asciiTheme slots on body runs; theme supersedes a stale literal", async () => {
    const { document: doc } = await importDocx(
      buildDocx({
        bodyXml: `<w:p><w:r>
          <w:rPr><w:rFonts w:ascii="StaleFace" w:asciiTheme="minorHAnsi"/></w:rPr>
          <w:t>body text</w:t>
        </w:r></w:p>`,
      }),
    );
    const run = (doc.body[0] as Paragraph).runs[0] as TextRun;
    expect(run.properties.fontFamily).toBe("Georgia");
    expect(run.properties.fontThemeSlot).toBe("minor");
    expect(doc.themeFonts).toEqual({ major: "Cambria", minor: "Georgia" });
  });

  it("resolves a slot-only heading STYLE to the theme major face", async () => {
    const { document: doc } = await importDocx(
      buildDocx({
        stylesXml: STYLES_WITH_HEADING,
        bodyXml: `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>H</w:t></w:r></w:p>`,
      }),
    );
    const h1 = doc.styles.find((s) => s.id === "Heading1");
    expect(h1?.runDefaults?.fontFamily).toBe("Cambria");
    expect(h1?.runDefaults?.fontThemeSlot).toBe("major");
  });

  it("baseline fallbacks use the theme faces when styles omit fonts entirely", async () => {
    const { document: doc } = await importDocx(
      buildDocx({
        stylesXml: `<?xml version="1.0"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
</w:styles>`,
        bodyXml: "<w:p><w:r><w:t>x</w:t></w:r></w:p>",
      }),
    );
    const h1 = doc.styles.find((s) => s.id === "Heading1");
    expect(h1?.runDefaults?.fontFamily).toBe("Cambria");
  });

  it("keeps the hardcoded fallbacks when there is no theme part", async () => {
    const { document: doc } = await importDocx(
      buildDocx({
        theme: false,
        stylesXml: `<?xml version="1.0"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
</w:styles>`,
        bodyXml: `<w:p><w:r><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/></w:rPr><w:t>x</w:t></w:r></w:p>`,
      }),
    );
    const h1 = doc.styles.find((s) => s.id === "Heading1");
    expect(h1?.runDefaults?.fontFamily).toBe("Calibri Light");
    // Slot recorded but unresolved — no theme to resolve against.
    const run = (doc.body[0] as Paragraph).runs[0] as TextRun;
    expect(run.properties.fontThemeSlot).toBe("minor");
    expect(run.properties.fontFamily).toBeUndefined();
  });

  it("export re-emits the theme linkage and the round trip is a fixpoint", async () => {
    const { document: doc } = await importDocx(
      buildDocx({
        bodyXml: `<w:p><w:r>
          <w:rPr><w:rFonts w:asciiTheme="majorHAnsi"/></w:rPr>
          <w:t>themed</w:t>
        </w:r></w:p>`,
      }),
    );
    const parts = unzipSync(exportDocx(doc).bytes);
    const xml = new TextDecoder().decode(parts["word/document.xml"]);
    expect(xml).toContain('w:asciiTheme="majorHAnsi"');
    expect(xml).toContain('w:ascii="Cambria"');

    const back = (await importDocx(exportDocx(doc).bytes)).document;
    const run = (back.body[0] as Paragraph).runs[0] as TextRun;
    expect(run.properties.fontFamily).toBe("Cambria");
    expect(run.properties.fontThemeSlot).toBe("major");
    expect(back.themeFonts).toEqual({ major: "Cambria", minor: "Georgia" });
  });
});
