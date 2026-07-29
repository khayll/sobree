import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { Paragraph } from "../doc/types";
import { exportDocx } from "./export/index";
import { importDocx } from "./import/index";

const TEXT = new TextEncoder();

/**
 * TOC field IDENTITY — the multi-paragraph complex field Word writes as
 * fldChar begin + `TOC …` instrText + separate in the FIRST entry
 * paragraph and a lone fldChar end paragraphs later. Import stamps
 * `fieldWrap` membership across the span; export re-emits the field
 * chars from first/last membership, so Word can "Update Table of
 * Contents" again after a Sobree save.
 */
function docxWithBody(bodyXml: string): Uint8Array {
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
  <w:body>${bodyXml}</w:body>
</w:document>`,
    ),
  });
}

/** The gatech/fedramp/cms wire shape, reduced: 2 hyperlinked entries + lone-end paragraph. */
const TOC_BODY = `
  <w:p>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="separate"/></w:r>
    <w:hyperlink w:anchor="_Toc1"><w:r><w:t>Entry one</w:t></w:r></w:hyperlink>
  </w:p>
  <w:p>
    <w:hyperlink w:anchor="_Toc2"><w:r><w:t>Entry two</w:t></w:r></w:hyperlink>
  </w:p>
  <w:p>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
  <w:p><w:r><w:t>After the TOC</w:t></w:r></w:p>
  <w:p>
    <w:bookmarkStart w:id="1" w:name="_Toc1"/><w:r><w:t>H1</w:t></w:r><w:bookmarkEnd w:id="1"/>
    <w:bookmarkStart w:id="2" w:name="_Toc2"/><w:bookmarkEnd w:id="2"/>
  </w:p>`;

function wraps(doc: { body: readonly { kind: string }[] }): (number | undefined)[] {
  return doc.body.map((b) =>
    b.kind === "paragraph" ? (b as Paragraph).properties.fieldWrap?.id : undefined,
  );
}

describe("TOC field identity", () => {
  it("stamps fieldWrap membership across the span, open and close paragraphs inclusive", async () => {
    const { document: doc } = await importDocx(docxWithBody(TOC_BODY));
    expect(wraps(doc)).toEqual([0, 0, 0, undefined, undefined]);
    const first = doc.body[0] as Paragraph;
    expect(first.properties.fieldWrap?.instruction).toBe('TOC \\o "1-3" \\h \\z \\u');
    // Entries render as today — the first paragraph still holds its link.
    expect(first.runs.some((r) => r.kind === "hyperlink")).toBe(true);
  });

  it("re-emits begin + instrText + separate and the end fldChar on export", async () => {
    const { document: doc } = await importDocx(docxWithBody(TOC_BODY));
    const parts = unzipSync(exportDocx(doc).bytes);
    const xml = new TextDecoder().decode(parts["word/document.xml"]);
    expect(xml).toContain('<w:fldChar w:fldCharType="begin"/>');
    expect(xml).toContain(' TOC \\o "1-3" \\h \\z \\u ');
    expect(xml).toContain('<w:fldChar w:fldCharType="separate"/>');
    expect(xml).toContain('<w:fldChar w:fldCharType="end"/>');
    // begin sits BEFORE the first entry's hyperlink, end after entry two.
    expect(xml.indexOf('fldCharType="begin"')).toBeLessThan(xml.indexOf("Entry one"));
    expect(xml.indexOf("Entry two")).toBeLessThan(xml.indexOf('fldCharType="end"'));
  });

  it("membership reaches a fixpoint through export → import", async () => {
    const { document: doc } = await importDocx(docxWithBody(TOC_BODY));
    const back = (await importDocx(exportDocx(doc).bytes)).document;
    expect(wraps(back)).toEqual(wraps(doc));
    const first = back.body[0] as Paragraph;
    expect(first.properties.fieldWrap?.instruction).toBe('TOC \\o "1-3" \\h \\z \\u');
    // Entry text intact both times.
    const texts = (i: number, d: typeof doc) =>
      (d.body[i] as Paragraph).runs
        .flatMap((r) => (r.kind === "hyperlink" ? r.children : [r]))
        .flatMap((r) => (r.kind === "text" ? [r.text] : []))
        .join("");
    expect(texts(0, back)).toBe(texts(0, doc));
    expect(texts(1, back)).toBe(texts(1, doc));
  });

  it("multiple TOC fields in one document get distinct ids (the cms shape)", async () => {
    const twoTocs = `${TOC_BODY}
      <w:p>
        <w:r><w:fldChar w:fldCharType="begin"/></w:r>
        <w:r><w:instrText xml:space="preserve"> TOC \\h \\z \\c "Figure" </w:instrText></w:r>
        <w:r><w:fldChar w:fldCharType="separate"/></w:r>
        <w:hyperlink w:anchor="_Toc9"><w:r><w:t>Figure 1</w:t></w:r></w:hyperlink>
      </w:p>
      <w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
    const { document: doc } = await importDocx(docxWithBody(twoTocs));
    expect(wraps(doc)).toEqual([0, 0, 0, undefined, undefined, 1, 1]);
    const back = (await importDocx(exportDocx(doc).bytes)).document;
    expect(wraps(back)).toEqual(wraps(doc));
  });

  it("a completed single-paragraph field never becomes a fieldWrap", async () => {
    const { document: doc } = await importDocx(
      docxWithBody(
        `<w:p>
           <w:r><w:fldChar w:fldCharType="begin"/></w:r>
           <w:r><w:instrText> PAGE </w:instrText></w:r>
           <w:r><w:fldChar w:fldCharType="separate"/></w:r>
           <w:r><w:t>3</w:t></w:r>
           <w:r><w:fldChar w:fldCharType="end"/></w:r>
         </w:p>`,
      ),
    );
    const p = doc.body[0] as Paragraph;
    expect(p.properties.fieldWrap).toBeUndefined();
    expect(p.runs.some((r) => r.kind === "field")).toBe(true);
  });

  it("an unterminated non-TOC field does not wrap the rest of the document", async () => {
    const { document: doc } = await importDocx(
      docxWithBody(
        `<w:p>
           <w:r><w:fldChar w:fldCharType="begin"/></w:r>
           <w:r><w:instrText> PAGE </w:instrText></w:r>
           <w:r><w:fldChar w:fldCharType="separate"/></w:r>
           <w:r><w:t>3</w:t></w:r>
         </w:p>
         <w:p><w:r><w:t>free paragraph</w:t></w:r></w:p>`,
      ),
    );
    expect(wraps(doc)).toEqual([undefined, undefined]);
    // The open field's cached result text still survives as a plain run.
    const p = doc.body[0] as Paragraph;
    expect(p.runs.some((r) => r.kind === "text" && r.text === "3")).toBe(true);
  });
});
