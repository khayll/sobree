import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { FieldRun, HyperlinkRun, Paragraph } from "../doc/types";
import { exportDocx } from "./export/index";
import { importDocx } from "./import/index";

const TEXT = new TextEncoder();

/**
 * Word-shaped TOC entry: a heading carrying a `_Toc` bookmark, and an
 * entry paragraph whose `<w:hyperlink w:anchor>` wraps the entry text
 * plus a nested PAGEREF complex field holding the cached page number.
 * This is the exact wire shape `TOC \o "1-3" \h` produces per entry.
 */
function buildTocEntryDocx(): Uint8Array {
  const contentTypes = TEXT.encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  const rootRels = TEXT.encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  const documentXml = TEXT.encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:hyperlink w:anchor="_Toc1" w:history="1">
        <w:r><w:t>Chapter One</w:t></w:r>
        <w:r><w:tab/></w:r>
        <w:r><w:fldChar w:fldCharType="begin"/></w:r>
        <w:r><w:instrText xml:space="preserve"> PAGEREF _Toc1 \\h </w:instrText></w:r>
        <w:r><w:fldChar w:fldCharType="separate"/></w:r>
        <w:r><w:t>5</w:t></w:r>
        <w:r><w:fldChar w:fldCharType="end"/></w:r>
      </w:hyperlink>
    </w:p>
    <w:p>
      <w:bookmarkStart w:id="1" w:name="_Toc1"/>
      <w:r><w:t>Chapter One heading</w:t></w:r>
      <w:bookmarkEnd w:id="1"/>
    </w:p>
  </w:body>
</w:document>`,
  );
  return zipSync({
    "[Content_Types].xml": contentTypes,
    "_rels/.rels": rootRels,
    "word/document.xml": documentXml,
  });
}

function entryLink(p: Paragraph): HyperlinkRun {
  const link = p.runs.find((r): r is HyperlinkRun => r.kind === "hyperlink");
  if (!link) throw new Error("no hyperlink in entry paragraph");
  return link;
}

describe("internal hyperlinks + nested PAGEREF fields", () => {
  it("imports w:anchor as a fragment href and the nested field as a FieldRun", async () => {
    const { document: doc } = await importDocx(buildTocEntryDocx());

    const link = entryLink(doc.body[0] as Paragraph);
    expect(link.href).toBe("#_Toc1");
    const field = link.children.find((r): r is FieldRun => r.kind === "field");
    expect(field?.instruction.trim()).toBe("PAGEREF _Toc1 \\h");
    expect(field?.cached).toBe("5");
    // The entry text survives alongside the field.
    const label = link.children.find((r) => r.kind === "text" && r.text === "Chapter One");
    expect(label).toBeDefined();
  });

  it("round-trips the anchor and nested field through export → import", async () => {
    const { document: doc } = await importDocx(buildTocEntryDocx());
    const back = (await importDocx(exportDocx(doc).bytes)).document;

    const link = entryLink(back.body[0] as Paragraph);
    expect(link.href).toBe("#_Toc1");
    const field = link.children.find((r): r is FieldRun => r.kind === "field");
    expect(field?.instruction.trim()).toBe("PAGEREF _Toc1 \\h");
    expect(field?.cached).toBe("5");

    // And the wire form is a w:anchor attribute, not a relationship.
    const parts = unzipSync(exportDocx(doc).bytes);
    const xml = new TextDecoder().decode(parts["word/document.xml"]);
    expect(xml.includes('w:anchor="_Toc1"')).toBe(true);
  });

  it("keeps external hyperlinks on the relationship path", async () => {
    const { document: doc } = await importDocx(buildTocEntryDocx());
    (doc.body[0] as Paragraph).runs.push({
      kind: "hyperlink",
      href: "https://example.com/",
      children: [{ kind: "text", text: "ext", properties: {} }],
    });
    const back = (await importDocx(exportDocx(doc).bytes)).document;
    const links = (back.body[0] as Paragraph).runs.filter(
      (r): r is HyperlinkRun => r.kind === "hyperlink",
    );
    expect(links.map((l) => l.href)).toEqual(["#_Toc1", "https://example.com/"]);
  });
});
