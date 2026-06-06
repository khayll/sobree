import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { importDocx } from "./import/index";
import { walkBlock } from "../doc/walk";
import type { Block, InlineRun } from "../doc/types";

const TEXT = new TextEncoder();

/**
 * Build a minimal .docx whose header part carries BOTH a plain flow
 * paragraph AND an anchored textbox drawing. Exercises the
 * `loadHeaderFooterParts` import path: the anchored drawing must land in
 * `doc.headerFooterFrames` and be claimed out of `headerFooterBodies`
 * flow (no double-render). Modelled on jellap.docx's contact-info box.
 */
function buildHeaderFrameDocx(): Uint8Array {
  const contentTypes = TEXT.encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>`,
  );
  const rootRels = TEXT.encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  const documentRels = TEXT.encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
</Relationships>`,
  );
  const documentXml = TEXT.encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>Body text</w:t></w:r></w:p>
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId10"/>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>
    </w:sectPr>
  </w:body>
</w:document>`,
  );
  // Header: one plain flow paragraph + one paragraph hosting an anchored
  // textbox. The textbox body carries the contact line.
  const header1Xml = TEXT.encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
  <w:p><w:r><w:t>Plain header line</w:t></w:r></w:p>
  <w:p>
    <w:r>
      <w:drawing>
        <wp:anchor behindDoc="0">
          <wp:extent cx="1800000" cy="900000"/>
          <wp:positionH relativeFrom="page"><wp:posOffset>500000</wp:posOffset></wp:positionH>
          <wp:positionV relativeFrom="paragraph"><wp:posOffset>300000</wp:posOffset></wp:positionV>
          <wp:wrapNone/>
          <a:graphic>
            <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
              <wps:wsp>
                <wps:txbx>
                  <w:txbxContent>
                    <w:p><w:r><w:t>Cim: 1012 Budapest</w:t></w:r></w:p>
                  </w:txbxContent>
                </wps:txbx>
              </wps:wsp>
            </a:graphicData>
          </a:graphic>
        </wp:anchor>
      </w:drawing>
    </w:r>
  </w:p>
</w:hdr>`,
  );

  return zipSync({
    "[Content_Types].xml": contentTypes,
    "_rels/.rels": rootRels,
    "word/document.xml": documentXml,
    "word/_rels/document.xml.rels": documentRels,
    "word/header1.xml": header1Xml,
  });
}

function drawingRuns(blocks: readonly Block[]): InlineRun[] {
  const out: InlineRun[] = [];
  for (const block of blocks) {
    walkBlock(block, {
      run: (run) => {
        if (run.kind === "drawing") out.push(run);
      },
    });
  }
  return out;
}

function allText(blocks: readonly Block[]): string {
  let text = "";
  for (const block of blocks) {
    walkBlock(block, {
      run: (run) => {
        if (run.kind === "text") text += run.text;
      },
    });
  }
  return text;
}

describe("header anchored frames", () => {
  it("extracts header anchored drawings into headerFooterFrames", async () => {
    const { document: doc } = await importDocx(buildHeaderFrameDocx());
    const frames = doc.headerFooterFrames;
    expect(frames).toBeDefined();
    const partFrames = frames?.["header1.xml"];
    expect(partFrames).toBeDefined();
    expect(partFrames).toHaveLength(1);
    const frame = partFrames![0]!;
    expect(frame.content.kind).toBe("textbox");
    expect(frame.widthEmu).toBe(1800000);
    expect(frame.heightEmu).toBe(900000);
    // The drawing's host paragraph is the header's 2nd block (index 1):
    // p0 = "Plain header line", p1 = the paragraph carrying the anchor.
    // Recording it lets the renderer position a verticalFrom="paragraph"
    // frame against that header paragraph's rendered Y.
    expect(frame.anchor.verticalFrom).toBe("paragraph");
    expect(frame.anchor.paragraphIndex).toBe(1);
    if (frame.content.kind === "textbox") {
      expect(allText(frame.content.body)).toContain("Cim: 1012 Budapest");
    }
  });

  it("claims the anchored drawing out of header flow (no double-render)", async () => {
    const { document: doc } = await importDocx(buildHeaderFrameDocx());
    const flow = doc.headerFooterBodies["header1.xml"];
    expect(flow).toBeDefined();
    // The plain line stays in flow; the anchored drawing is gone — its
    // text lives only in the frame, not duplicated in the flow.
    expect(allText(flow!)).toContain("Plain header line");
    expect(allText(flow!)).not.toContain("Cim: 1012 Budapest");
    expect(drawingRuns(flow!)).toHaveLength(0);
  });

  it("leaves headerFooterFrames absent when a header has no floats", async () => {
    // Reuse the body-only path: a doc with no header at all.
    const docXml = TEXT.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body>
</w:document>`,
    );
    const bytes = zipSync({
      "[Content_Types].xml": TEXT.encode(
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      ),
      "_rels/.rels": TEXT.encode(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      ),
      "word/document.xml": docXml,
    });
    const { document: doc } = await importDocx(bytes);
    expect(doc.headerFooterFrames).toBeUndefined();
  });
});
