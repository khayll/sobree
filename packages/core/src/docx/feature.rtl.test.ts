import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { Paragraph, TextRun } from "../doc/types";
import { renderSobreeDocument } from "../editor/view/docRenderer/index";
import { serializeHostsToDocument } from "../editor/view/docSerialize/index";
import { exportDocx } from "./export/index";
import { importDocx } from "./import/index";

const TEXT = new TextEncoder();

/**
 * RTL / bidi fixtures. The model keeps `alignment` LOGICAL (wire `jc`:
 * left ≡ start) and stores `bidi` / `rtl` only when explicitly ON; the
 * renderer owns the physical mapping (dir="rtl" + left↔right swap) and
 * the DOM serializer its inverse. Each test pins one of those contracts
 * where the hypotheses would diverge.
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

const ARABIC_PARA = `<w:p>
  <w:pPr><w:bidi/><w:jc w:val="left"/></w:pPr>
  <w:r>
    <w:rPr><w:rtl/><w:sz w:val="24"/><w:szCs w:val="28"/></w:rPr>
    <w:t>مرحبا بالعالم</w:t>
  </w:r>
</w:p>`;

describe("RTL / bidi", () => {
  it("imports bidi + rtl + divergent szCs; alignment stays logical", async () => {
    const { document: doc } = await importDocx(docxWithBody(ARABIC_PARA));
    const p = doc.body[0] as Paragraph;
    expect(p.properties.bidi).toBe(true);
    expect(p.properties.alignment).toBe("left");
    const run = p.runs[0] as TextRun;
    expect(run.properties.rtl).toBe(true);
    expect(run.properties.fontSizePt).toBe(12);
    expect(run.properties.fontSizeCsPt).toBe(14);
  });

  it("normalizes explicit-off toggles to absent (the RTL-enabled-Word LTR shape)", async () => {
    const { document: doc } = await importDocx(
      docxWithBody(
        `<w:p>
           <w:pPr><w:bidi w:val="0"/></w:pPr>
           <w:r><w:rPr><w:rtl w:val="0"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t>plain</w:t></w:r>
         </w:p>`,
      ),
    );
    const p = doc.body[0] as Paragraph;
    expect(p.properties.bidi).toBeUndefined();
    const run = p.runs[0] as TextRun;
    expect(run.properties.rtl).toBeUndefined();
    // Equal szCs carries no information — the exporter mirrors it.
    expect(run.properties.fontSizeCsPt).toBeUndefined();
  });

  it("renders dir=rtl with the physical left↔right swap, and read-back inverts it", async () => {
    const { document: doc } = await importDocx(docxWithBody(ARABIC_PARA));
    const host = document.createElement("div");
    renderSobreeDocument(doc, host);

    const p = host.querySelector("p");
    expect(p?.getAttribute("dir")).toBe("rtl");
    // Logical "left" (start) on a bidi paragraph is PHYSICAL right.
    expect(p?.style.textAlign).toBe("right");
    const span = p?.querySelector("span[dir=rtl]");
    expect(span?.textContent).toBe("مرحبا بالعالم");

    const back = serializeHostsToDocument([host]);
    const bp = back.body[0] as Paragraph;
    expect(bp.properties.bidi).toBe(true);
    expect(bp.properties.alignment).toBe("left");
    const runs = bp.runs.filter((r): r is TextRun => r.kind === "text");
    expect(runs.some((r) => r.properties.rtl === true)).toBe(true);
  });

  it("round-trips bidi/rtl/szCs through export → import", async () => {
    const { document: doc } = await importDocx(docxWithBody(ARABIC_PARA));
    const back = (await importDocx(exportDocx(doc).bytes)).document;
    const p = back.body[0] as Paragraph;
    expect(p.properties.bidi).toBe(true);
    // Pre-existing exporter convention: `jc=left` (the logical default,
    // start) is omitted on the wire, so it reads back as ABSENT — which
    // renders identically (text-align: start). Semantically lossless.
    expect(p.properties.alignment).toBeUndefined();
    const run = p.runs[0] as TextRun;
    expect(run.properties.rtl).toBe(true);
    expect(run.properties.fontSizeCsPt).toBe(14);
    expect(run.text).toBe("مرحبا بالعالم");
  });
});
