import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { Paragraph, Table } from "../doc/types";
import { exportDocx } from "./export/index";
import { importDocx } from "./import/index";

const TEXT = new TextEncoder();

/**
 * Block-level bookmark markers — starts/ends that are direct children
 * of `w:body` / `w:tc` rather than paragraph content. Word writes TOC
 * targets before the first paragraph this way, and `_GoBack` lands at
 * cell level. The importer normalizes them into the nearest paragraph
 * (blockMarkers.ts); these fixtures pin each rule.
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

function runKinds(p: Paragraph): string[] {
  return p.runs.map((r) => r.kind);
}

describe("block-level bookmark markers", () => {
  it("starts before the first paragraph attach to its front (TOC-target shape)", async () => {
    const { document: doc } = await importDocx(
      docxWithBody(
        `<w:bookmarkStart w:id="0" w:name="_Toc1"/>
         <w:bookmarkStart w:id="1" w:name="_Toc2"/>
         <w:p><w:r><w:t>Heading</w:t></w:r></w:p>`,
      ),
    );
    const p = doc.body[0] as Paragraph;
    expect(runKinds(p)).toEqual(["bookmarkStart", "bookmarkStart", "text"]);
    const names = p.runs.flatMap((r) => (r.kind === "bookmarkStart" ? [r.name] : []));
    expect(names).toEqual(["_Toc1", "_Toc2"]);
  });

  it("a body-level end closes on the previous paragraph; a zero-length pair stays adjacent", async () => {
    const { document: doc } = await importDocx(
      docxWithBody(
        `<w:p><w:r><w:t>covered</w:t></w:r></w:p>
         <w:bookmarkEnd w:id="7"/>
         <w:bookmarkStart w:id="0" w:name="_GoBack"/>
         <w:bookmarkEnd w:id="0"/>
         <w:p><w:r><w:t>after</w:t></w:r></w:p>`,
      ),
    );
    const [p1, p2] = doc.body as Paragraph[];
    expect(runKinds(p1 as Paragraph)).toEqual(["text", "bookmarkEnd"]);
    expect(runKinds(p2 as Paragraph)).toEqual(["bookmarkStart", "bookmarkEnd", "text"]);
  });

  it("markers pending at a table attach to its first paragraph; trailing ones to the last paragraph", async () => {
    const { document: doc } = await importDocx(
      docxWithBody(
        `<w:bookmarkStart w:id="3" w:name="_TableMark"/>
         <w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
         <w:p><w:r><w:t>tail</w:t></w:r></w:p>
         <w:bookmarkStart w:id="4" w:name="_Trailing"/>`,
      ),
    );
    const table = doc.body[0] as Table;
    const cellP = table.rows[0]?.cells[0]?.content[0] as Paragraph;
    expect(runKinds(cellP)).toEqual(["bookmarkStart", "text"]);
    const tail = doc.body[1] as Paragraph;
    expect(runKinds(tail)).toEqual(["text", "bookmarkStart"]);
  });

  it("cell-level markers normalize inside the cell (the _GoBack-in-tc shape)", async () => {
    const { document: doc } = await importDocx(
      docxWithBody(
        `<w:tbl><w:tr><w:tc>
           <w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/>
           <w:p><w:r><w:t>cell text</w:t></w:r></w:p>
         </w:tc></w:tr></w:tbl>`,
      ),
    );
    const table = doc.body[0] as Table;
    const cellP = table.rows[0]?.cells[0]?.content[0] as Paragraph;
    expect(runKinds(cellP)).toEqual(["bookmarkStart", "bookmarkEnd", "text"]);
  });

  it("normalization reaches a fixpoint through export → import", async () => {
    const { document: doc } = await importDocx(
      docxWithBody(
        `<w:bookmarkStart w:id="0" w:name="_Toc1"/>
         <w:p><w:r><w:t>Heading</w:t></w:r></w:p>
         <w:bookmarkEnd w:id="0"/>`,
      ),
    );
    const back = (await importDocx(exportDocx(doc).bytes)).document;
    expect(JSON.parse(JSON.stringify(back.body))).toEqual(JSON.parse(JSON.stringify(doc.body)));
  });
});
