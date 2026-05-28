import { describe, expect, it } from "vitest";

import { parseAnchoredFrames } from "./anchoredFrames";

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

const emptyCtx = { rels: new Map<string, string>() };

describe("parseAnchoredFrames", () => {
  it("returns [] when there are no <w:drawing> elements", () => {
    const doc = xml(`<w:body><w:p/></w:body>`);
    expect(parseAnchoredFrames(doc, emptyCtx)).toEqual([]);
  });

  it("skips inline drawings (no <wp:anchor>)", () => {
    const doc = xml(`<w:body><w:p><w:r><w:drawing>
      <wp:inline distT="0" distB="0" distL="0" distR="0">
        <wp:extent cx="914400" cy="914400"/>
      </wp:inline>
    </w:drawing></w:r></w:p></w:body>`);
    expect(parseAnchoredFrames(doc, emptyCtx)).toEqual([]);
  });

  it("parses an anchored picture with offsets and dimensions", () => {
    const rels = new Map([["rId7", "media/image1.png"]]);
    const doc = xml(`<w:body><w:p><w:r><w:drawing>
      <wp:anchor behindDoc="0">
        <wp:positionH relativeFrom="margin"><wp:posOffset>914400</wp:posOffset></wp:positionH>
        <wp:positionV relativeFrom="paragraph"><wp:posOffset>457200</wp:posOffset></wp:positionV>
        <wp:extent cx="1828800" cy="1828800"/>
        <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill></pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:anchor>
    </w:drawing></w:r></w:p></w:body>`);
    const frames = parseAnchoredFrames(doc, { rels });
    expect(frames).toHaveLength(1);
    const f = frames[0]!;
    expect(f.anchor.horizontalFrom).toBe("margin");
    expect(f.anchor.verticalFrom).toBe("paragraph");
    expect(f.offsetXEmu).toBe(914400);
    expect(f.offsetYEmu).toBe(457200);
    expect(f.widthEmu).toBe(1828800);
    expect(f.heightEmu).toBe(1828800);
    expect(f.behindText).toBeUndefined();
    expect(f.content).toEqual({ kind: "picture", partPath: "word/media/image1.png" });
  });

  it("sets behindText on `behindDoc=\"1\"` anchors", () => {
    const doc = xml(`<w:body><w:p><w:r><w:drawing>
      <wp:anchor behindDoc="1">
        <wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>
        <wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>
        <wp:extent cx="100" cy="100"/>
        <a:graphic><a:graphicData>
          <wps:wsp>
            <wps:spPr><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></wps:spPr>
          </wps:wsp>
        </a:graphicData></a:graphic>
      </wp:anchor>
    </w:drawing></w:r></w:p></w:body>`);
    const frames = parseAnchoredFrames(doc, emptyCtx);
    expect(frames[0]!.behindText).toBe(true);
  });

  it("parses a shape with fill and prstGeom", () => {
    const doc = xml(`<w:body><w:p><w:r><w:drawing>
      <wp:anchor>
        <wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>
        <wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>
        <wp:extent cx="500" cy="500"/>
        <a:graphic><a:graphicData>
          <wps:wsp>
            <wps:spPr>
              <a:prstGeom prst="ellipse"/>
              <a:solidFill><a:srgbClr val="00ff00"/></a:solidFill>
              <a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="dash"/></a:ln>
            </wps:spPr>
          </wps:wsp>
        </a:graphicData></a:graphic>
      </wp:anchor>
    </w:drawing></w:r></w:p></w:body>`);
    const frames = parseAnchoredFrames(doc, emptyCtx);
    expect(frames[0]!.content).toEqual({
      kind: "shape",
      geometry: "ellipse",
      fill: "#00FF00",
      border: { color: "#000000", widthEmu: 9525, style: "dashed" },
    });
  });

  it("parses a textbox shape and extracts its paragraph text", () => {
    const doc = xml(`<w:body><w:p><w:r><w:drawing>
      <wp:anchor>
        <wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>
        <wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>
        <wp:extent cx="500" cy="500"/>
        <a:graphic><a:graphicData>
          <wps:wsp>
            <wps:spPr/>
            <wps:txbx><w:txbxContent>
              <w:p><w:r><w:t>Hello</w:t></w:r></w:p>
              <w:p><w:r><w:t>World</w:t></w:r></w:p>
            </w:txbxContent></wps:txbx>
          </wps:wsp>
        </a:graphicData></a:graphic>
      </wp:anchor>
    </w:drawing></w:r></w:p></w:body>`);
    const frames = parseAnchoredFrames(doc, emptyCtx);
    expect(frames[0]!.content.kind).toBe("textbox");
    const tb = frames[0]!.content as Extract<typeof frames[0]["content"], { kind: "textbox" }>;
    expect(tb.body).toHaveLength(2);
    expect(tb.body[0]).toMatchObject({
      kind: "paragraph",
      runs: [{ kind: "text", text: "Hello" }],
    });
  });

  it("parses a wpg:wgp group with multiple child shapes", () => {
    const doc = xml(`<w:body><w:p><w:r><w:drawing>
      <wp:anchor>
        <wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>
        <wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>
        <wp:extent cx="1000" cy="1000"/>
        <a:graphic><a:graphicData>
          <wpg:wgp>
            <wpg:grpSpPr><a:xfrm><a:chExt cx="2000" cy="2000"/></a:xfrm></wpg:grpSpPr>
            <wps:wsp>
              <wps:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm><a:prstGeom prst="rect"/></wps:spPr>
            </wps:wsp>
            <wps:wsp>
              <wps:spPr><a:xfrm><a:off x="500" y="600"/><a:ext cx="700" cy="800"/></a:xfrm><a:prstGeom prst="ellipse"/></wps:spPr>
            </wps:wsp>
          </wpg:wgp>
        </a:graphicData></a:graphic>
      </wp:anchor>
    </w:drawing></w:r></w:p></w:body>`);
    const frames = parseAnchoredFrames(doc, emptyCtx);
    expect(frames[0]!.content.kind).toBe("group");
    const g = frames[0]!.content as Extract<typeof frames[0]["content"], { kind: "group" }>;
    expect(g.childCoordSystemCx).toBe(2000);
    expect(g.childCoordSystemCy).toBe(2000);
    expect(g.children).toHaveLength(2);
    expect(g.children[0]).toMatchObject({
      offsetXEmu: 100,
      offsetYEmu: 200,
      widthEmu: 300,
      heightEmu: 400,
      content: { kind: "shape", geometry: "rect" },
    });
    expect(g.children[1]).toMatchObject({
      offsetXEmu: 500,
      offsetYEmu: 600,
      widthEmu: 700,
      heightEmu: 800,
      content: { kind: "shape", geometry: "ellipse" },
    });
  });

  it("assigns deterministic ids based on document order", () => {
    const doc = xml(`<w:body>
      <w:p><w:r><w:drawing><wp:anchor>
        <wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>
        <wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>
        <wp:extent cx="100" cy="100"/>
        <a:graphic><a:graphicData><wps:wsp><wps:spPr><a:prstGeom prst="rect"/></wps:spPr></wps:wsp></a:graphicData></a:graphic>
      </wp:anchor></w:drawing></w:r></w:p>
      <w:p><w:r><w:drawing><wp:anchor>
        <wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>
        <wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>
        <wp:extent cx="100" cy="100"/>
        <a:graphic><a:graphicData><wps:wsp><wps:spPr><a:prstGeom prst="rect"/></wps:spPr></wps:wsp></a:graphicData></a:graphic>
      </wp:anchor></w:drawing></w:r></w:p>
    </w:body>`);
    const frames = parseAnchoredFrames(doc, emptyCtx);
    expect(frames.map((f) => f.id)).toEqual(["anchor-0", "anchor-1"]);
  });

  it("resolves paragraphIndex from the caller-supplied element map", () => {
    const doc = xml(`<w:body>
      <w:p id="P0"/>
      <w:p id="P1"><w:r><w:drawing><wp:anchor>
        <wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>
        <wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>
        <wp:extent cx="100" cy="100"/>
        <a:graphic><a:graphicData><wps:wsp><wps:spPr><a:prstGeom prst="rect"/></wps:spPr></wps:wsp></a:graphicData></a:graphic>
      </wp:anchor></w:drawing></w:r></w:p>
    </w:body>`);
    const ps = Array.from(doc.getElementsByTagName("w:p"));
    const map = new Map(ps.map((p, i) => [p, i] as const));
    const frames = parseAnchoredFrames(doc, { rels: new Map(), bodyParagraphIndexByElement: map });
    expect(frames[0]!.anchor.paragraphIndex).toBe(1);
  });
});
