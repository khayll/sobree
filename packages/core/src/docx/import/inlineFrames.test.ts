import { describe, expect, it } from "vitest";

import type { Block } from "../../doc/types";
import { parseInlineFrames } from "./inlineFrames";

function xml(source: string): Document {
  const wrapped = `<?xml version="1.0" encoding="UTF-8"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">
${source}
</w:document>`;
  return new DOMParser().parseFromString(wrapped, "application/xml");
}

// A stub body parser: turns each <w:p> into a plain Paragraph with
// its text content as a single TextRun. Real importer will pass the
// full body walker (Phase 1.2).
function stubParseBlockBody(txbxContent: Element): Block[] {
  const out: Block[] = [];
  for (const child of Array.from(txbxContent.children)) {
    if (child.namespaceURI !== "http://schemas.openxmlformats.org/wordprocessingml/2006/main") continue;
    if (child.localName === "p") {
      const text = (child.textContent ?? "").trim();
      out.push({
        kind: "paragraph",
        runs: text ? [{ kind: "text", text, properties: {} }] : [],
        properties: {},
      });
    }
  }
  return out;
}

const emptyCtx = { rels: new Map<string, string>(), parseBlockBody: stubParseBlockBody };

describe("parseInlineFrames", () => {
  it("returns [] when there are no <w:drawing> elements", () => {
    const doc = xml(`<w:body><w:p/></w:body>`);
    expect(parseInlineFrames(doc, emptyCtx)).toEqual([]);
  });

  it("skips anchored drawings (`<wp:anchor>`)", () => {
    const doc = xml(`<w:body><w:p><w:r><w:drawing>
      <wp:anchor>
        <wp:extent cx="100" cy="100"/>
        <a:graphic><a:graphicData>
          <wps:wsp>
            <wps:txbx><w:txbxContent><w:p>X</w:p></w:txbxContent></wps:txbx>
          </wps:wsp>
        </a:graphicData></a:graphic>
      </wp:anchor>
    </w:drawing></w:r></w:p></w:body>`);
    expect(parseInlineFrames(doc, emptyCtx)).toEqual([]);
  });

  it("skips inline drawings without a <wpg:wgp> group", () => {
    const doc = xml(`<w:body><w:p><w:r><w:drawing>
      <wp:inline>
        <wp:extent cx="100" cy="100"/>
        <a:graphic><a:graphicData uri="pic">
          <pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic>
        </a:graphicData></a:graphic>
      </wp:inline>
    </w:drawing></w:r></w:p></w:body>`);
    expect(parseInlineFrames(doc, emptyCtx)).toEqual([]);
  });

  it("skips wpg:wgp groups without a textbox payload", () => {
    const doc = xml(`<w:body><w:p><w:r><w:drawing>
      <wp:inline>
        <wp:extent cx="100" cy="100"/>
        <a:graphic><a:graphicData>
          <wpg:wgp>
            <wpg:grpSpPr><a:xfrm><a:chExt cx="100" cy="100"/></a:xfrm></wpg:grpSpPr>
            <wps:wsp><wps:spPr><a:prstGeom prst="rect"/></wps:spPr></wps:wsp>
          </wpg:wgp>
        </a:graphicData></a:graphic>
      </wp:inline>
    </w:drawing></w:r></w:p></w:body>`);
    expect(parseInlineFrames(doc, emptyCtx)).toEqual([]);
  });

  it("parses a section heading: group + textbox + pageBreakBefore from outer pPr", () => {
    const doc = xml(`<w:body>
      <w:p>
        <w:pPr><w:pageBreakBefore/></w:pPr>
        <w:r><w:drawing>
          <wp:inline>
            <wp:extent cx="5000000" cy="500000"/>
            <a:graphic><a:graphicData>
              <wpg:wgp>
                <wpg:grpSpPr>
                  <a:xfrm>
                    <a:ext cx="5000000" cy="500000"/>
                    <a:chExt cx="5000000" cy="500000"/>
                  </a:xfrm>
                </wpg:grpSpPr>
                <wps:wsp>
                  <wps:spPr>
                    <a:xfrm>
                      <a:off x="500000" y="100000"/>
                      <a:ext cx="4000000" cy="300000"/>
                    </a:xfrm>
                  </wps:spPr>
                  <wps:txbx>
                    <w:txbxContent>
                      <w:p>Objective</w:p>
                    </w:txbxContent>
                  </wps:txbx>
                </wps:wsp>
              </wpg:wgp>
            </a:graphicData></a:graphic>
          </wp:inline>
        </w:drawing></w:r>
      </w:p>
    </w:body>`);
    const out = parseInlineFrames(doc, emptyCtx);
    expect(out).toHaveLength(1);
    const f = out[0]!.frame;
    expect(f.kind).toBe("inline_frame");
    expect(f.pageBreakBefore).toBe(true);
    expect(f.groupExtentEmu).toEqual({ wEmu: 5000000, hEmu: 500000 });
    expect(f.sizeEmu).toEqual({ wEmu: 5000000, hEmu: 500000 });
    expect(f.textbox).toEqual({
      offsetEmu: { xEmu: 500000, yEmu: 100000 },
      sizeEmu: { wEmu: 4000000, hEmu: 300000 },
      body: [
        { kind: "paragraph", runs: [{ kind: "text", text: "Objective", properties: {} }], properties: {} },
      ],
    });
  });

  it("captures keepNext when the outer paragraph carries it", () => {
    const doc = xml(`<w:body>
      <w:p>
        <w:pPr><w:keepNext/></w:pPr>
        <w:r><w:drawing>
          <wp:inline>
            <wp:extent cx="100" cy="100"/>
            <a:graphic><a:graphicData>
              <wpg:wgp>
                <wpg:grpSpPr><a:xfrm><a:chExt cx="100" cy="100"/></a:xfrm></wpg:grpSpPr>
                <wps:wsp>
                  <wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="50" cy="50"/></a:xfrm></wps:spPr>
                  <wps:txbx><w:txbxContent><w:p>Heading</w:p></w:txbxContent></wps:txbx>
                </wps:wsp>
              </wpg:wgp>
            </a:graphicData></a:graphic>
          </wp:inline>
        </w:drawing></w:r>
      </w:p>
    </w:body>`);
    const f = parseInlineFrames(doc, emptyCtx)[0]!.frame;
    expect(f.keepNext).toBe(true);
    expect(f.pageBreakBefore).toBeUndefined();
  });

  it("captures decorative pictures as siblings of the textbox", () => {
    const rels = new Map([["rId7", "media/image2.png"]]);
    const doc = xml(`<w:body><w:p><w:r><w:drawing>
      <wp:inline>
        <wp:extent cx="1000" cy="500"/>
        <a:graphic><a:graphicData>
          <wpg:wgp>
            <wpg:grpSpPr><a:xfrm><a:chExt cx="1000" cy="500"/></a:xfrm></wpg:grpSpPr>
            <wps:wsp>
              <wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="800" cy="500"/></a:xfrm></wps:spPr>
              <wps:txbx><w:txbxContent><w:p>Heading</w:p></w:txbxContent></wps:txbx>
            </wps:wsp>
            <pic:pic>
              <pic:nvPicPr><pic:cNvPr descr="atom"/></pic:nvPicPr>
              <pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill>
              <pic:spPr>
                <a:xfrm><a:off x="850" y="100"/><a:ext cx="100" cy="100"/></a:xfrm>
              </pic:spPr>
            </pic:pic>
          </wpg:wgp>
        </a:graphicData></a:graphic>
      </wp:inline>
    </w:drawing></w:r></w:p></w:body>`);
    const f = parseInlineFrames(doc, { ...emptyCtx, rels })[0]!.frame;
    expect(f.pictures).toHaveLength(1);
    expect(f.pictures[0]).toEqual({
      partPath: "word/media/image2.png",
      offsetEmu: { xEmu: 850, yEmu: 100 },
      sizeEmu: { wEmu: 100, hEmu: 100 },
      altText: "atom",
    });
  });

  it("captures decorative shapes (rect / ellipse) without textbox payload", () => {
    const doc = xml(`<w:body><w:p><w:r><w:drawing>
      <wp:inline>
        <wp:extent cx="1000" cy="500"/>
        <a:graphic><a:graphicData>
          <wpg:wgp>
            <wpg:grpSpPr><a:xfrm><a:chExt cx="1000" cy="500"/></a:xfrm></wpg:grpSpPr>
            <wps:wsp>
              <wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="800" cy="500"/></a:xfrm></wps:spPr>
              <wps:txbx><w:txbxContent><w:p>Heading</w:p></w:txbxContent></wps:txbx>
            </wps:wsp>
            <wps:wsp>
              <wps:spPr>
                <a:xfrm><a:off x="850" y="100"/><a:ext cx="100" cy="100"/></a:xfrm>
                <a:prstGeom prst="ellipse"/>
                <a:solidFill><a:srgbClr val="ff0000"/></a:solidFill>
              </wps:spPr>
            </wps:wsp>
          </wpg:wgp>
        </a:graphicData></a:graphic>
      </wp:inline>
    </w:drawing></w:r></w:p></w:body>`);
    const f = parseInlineFrames(doc, emptyCtx)[0]!.frame;
    expect(f.shapes).toHaveLength(1);
    expect(f.shapes[0]).toEqual({
      geometry: "ellipse",
      offsetEmu: { xEmu: 850, yEmu: 100 },
      sizeEmu: { wEmu: 100, hEmu: 100 },
      fill: "#FF0000",
    });
  });

  it("returns drawingEl and hostParagraphEl alongside each frame", () => {
    const doc = xml(`<w:body>
      <w:p id="HOST">
        <w:r><w:drawing>
          <wp:inline>
            <wp:extent cx="100" cy="100"/>
            <a:graphic><a:graphicData>
              <wpg:wgp>
                <wpg:grpSpPr><a:xfrm><a:chExt cx="100" cy="100"/></a:xfrm></wpg:grpSpPr>
                <wps:wsp>
                  <wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></wps:spPr>
                  <wps:txbx><w:txbxContent><w:p>X</w:p></w:txbxContent></wps:txbx>
                </wps:wsp>
              </wpg:wgp>
            </a:graphicData></a:graphic>
          </wp:inline>
        </w:drawing></w:r>
      </w:p>
    </w:body>`);
    const [parsed] = parseInlineFrames(doc, emptyCtx);
    expect(parsed!.drawingEl.localName).toBe("drawing");
    expect(parsed!.hostParagraphEl.getAttribute("id")).toBe("HOST");
  });

  it("multiple inline frames retain document order", () => {
    const doc = xml(`<w:body>
      <w:p>
        <w:r><w:drawing><wp:inline><wp:extent cx="100" cy="100"/>
          <a:graphic><a:graphicData><wpg:wgp>
            <wpg:grpSpPr><a:xfrm><a:chExt cx="100" cy="100"/></a:xfrm></wpg:grpSpPr>
            <wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></wps:spPr>
              <wps:txbx><w:txbxContent><w:p>First</w:p></w:txbxContent></wps:txbx>
            </wps:wsp>
          </wpg:wgp></a:graphicData></a:graphic>
        </wp:inline></w:drawing></w:r>
      </w:p>
      <w:p>
        <w:r><w:drawing><wp:inline><wp:extent cx="100" cy="100"/>
          <a:graphic><a:graphicData><wpg:wgp>
            <wpg:grpSpPr><a:xfrm><a:chExt cx="100" cy="100"/></a:xfrm></wpg:grpSpPr>
            <wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></wps:spPr>
              <wps:txbx><w:txbxContent><w:p>Second</w:p></w:txbxContent></wps:txbx>
            </wps:wsp>
          </wpg:wgp></a:graphicData></a:graphic>
        </wp:inline></w:drawing></w:r>
      </w:p>
    </w:body>`);
    const frames = parseInlineFrames(doc, emptyCtx);
    expect(frames).toHaveLength(2);
    const body0 = frames[0]!.frame.textbox?.body[0];
    const body1 = frames[1]!.frame.textbox?.body[0];
    expect(body0).toMatchObject({ runs: [{ text: "First" }] });
    expect(body1).toMatchObject({ runs: [{ text: "Second" }] });
  });
});
