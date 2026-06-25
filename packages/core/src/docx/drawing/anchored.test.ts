import { describe, expect, it } from "vitest";

import { parseAnchoredFrames, parseVmlFloatingFrames } from "./anchored";

function xml(source: string): Document {
  const wrapped = `<?xml version="1.0" encoding="UTF-8"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">
${source}
</w:document>`;
  return new DOMParser().parseFromString(wrapped, "application/xml");
}

const emptyCtx = { rels: new Map<string, string>() };

describe("parseAnchoredFrames", () => {
  it("returns [] when there are no <w:drawing> elements", () => {
    const doc = xml("<w:body><w:p/></w:body>");
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

  it('sets behindText on `behindDoc="1"` anchors', () => {
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

  it("captures wrap mode, wrapText side, and distT/B/L/R clearance", () => {
    const rels = new Map([["rId7", "media/image1.png"]]);
    const doc = xml(`<w:body><w:p><w:r><w:drawing>
      <wp:anchor behindDoc="0" distT="0" distB="0" distL="114300" distR="228600">
        <wp:positionH relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionH>
        <wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>
        <wp:extent cx="914400" cy="914400"/>
        <wp:wrapSquare wrapText="right"/>
        <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill></pic:pic>
        </a:graphicData></a:graphic>
      </wp:anchor>
    </w:drawing></w:r></w:p></w:body>`);
    const f = parseAnchoredFrames(doc, { rels })[0]!;
    expect(f.wrap).toBe("square");
    expect(f.wrapText).toBe("right");
    expect(f.textDistancesEmu).toEqual({
      topEmu: 0,
      bottomEmu: 0,
      leftEmu: 114300,
      rightEmu: 228600,
    });
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

  it("resolves a ribbon shape's fill from its style fillRef (no spPr fill)", () => {
    // The black step-banner: fill lives only in `<wps:style><a:fillRef>`,
    // tinted with theme `dk1`. Without the style-ref fallback it imports
    // fill-less and the white heading on top renders invisible.
    const doc = xml(`<w:body><w:p><w:r><w:drawing>
      <wp:anchor>
        <wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>
        <wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>
        <wp:extent cx="6858000" cy="782053"/>
        <a:graphic><a:graphicData>
          <wps:wsp>
            <wps:spPr><a:prstGeom prst="round2SameRect"/></wps:spPr>
            <wps:style><a:fillRef idx="1"><a:schemeClr val="dk1"/></a:fillRef></wps:style>
          </wps:wsp>
        </a:graphicData></a:graphic>
      </wp:anchor>
    </w:drawing></w:r></w:p></w:body>`);
    const frames = parseAnchoredFrames(doc, { rels: new Map(), theme: { dk1: "#000000" } });
    expect(frames[0]!.content).toEqual({
      kind: "shape",
      geometry: "roundedRect",
      fill: "#000000",
    });
  });

  it("expands a rightArrow preset into a custom path in the frame box", () => {
    const doc = xml(`<w:body><w:p><w:r><w:drawing>
      <wp:anchor>
        <wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>
        <wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>
        <wp:extent cx="26" cy="16"/>
        <a:graphic><a:graphicData>
          <wps:wsp>
            <wps:spPr><a:prstGeom prst="rightArrow"><a:avLst/></a:prstGeom></wps:spPr>
            <wps:style><a:fillRef idx="1"><a:schemeClr val="dk1"/></a:fillRef></wps:style>
          </wps:wsp>
        </a:graphicData></a:graphic>
      </wp:anchor>
    </w:drawing></w:r></w:p></w:body>`);
    const frames = parseAnchoredFrames(doc, { rels: new Map(), theme: { dk1: "#000000" } });
    expect(frames[0]!.content).toEqual({
      kind: "shape",
      geometry: "custom",
      fill: "#000000",
      path: { widthEmu: 26, heightEmu: 16, d: "M0 4 L18 4 L18 0 L26 8 L18 16 L18 12 L0 12 Z" },
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
    const tb = frames[0]!.content as Extract<(typeof frames)[0]["content"], { kind: "textbox" }>;
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
    const g = frames[0]!.content as Extract<(typeof frames)[0]["content"], { kind: "group" }>;
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

  it("parses a <a:custGeom> shape into geometry 'custom' with an SVG path", () => {
    const doc = xml(`<w:body><w:p><w:r><w:drawing>
      <wp:anchor>
        <wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>
        <wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>
        <wp:extent cx="133350" cy="304800"/>
        <a:graphic><a:graphicData>
          <wps:wsp>
            <wps:spPr>
              <a:xfrm><a:off x="0" y="0"/><a:ext cx="133350" cy="304800"/></a:xfrm>
              <a:custGeom><a:pathLst>
                <a:path w="133350" h="304800">
                  <a:moveTo><a:pt x="10" y="20"/></a:moveTo>
                  <a:lnTo><a:pt x="100" y="20"/></a:lnTo>
                  <a:close/>
                </a:path>
              </a:pathLst></a:custGeom>
              <a:solidFill><a:srgbClr val="FED600"/></a:solidFill>
            </wps:spPr>
          </wps:wsp>
        </a:graphicData></a:graphic>
      </wp:anchor>
    </w:drawing></w:r></w:p></w:body>`);
    const frames = parseAnchoredFrames(doc, emptyCtx);
    expect(frames[0]!.content).toMatchObject({
      kind: "shape",
      geometry: "custom",
      fill: "#FED600",
      path: { widthEmu: 133350, heightEmu: 304800, d: "M 10 20 L 100 20 Z" },
    });
  });

  it("reads the group's <a:chOff> child-coordinate origin", () => {
    const doc = xml(`<w:body><w:p><w:r><w:drawing>
      <wp:anchor>
        <wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>
        <wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>
        <wp:extent cx="1000" cy="1000"/>
        <a:graphic><a:graphicData>
          <wpg:wgp>
            <wpg:grpSpPr><a:xfrm><a:chOff x="640436" y="458979"/><a:chExt cx="1066800" cy="314325"/></a:xfrm></wpg:grpSpPr>
            <wps:wsp>
              <wps:spPr><a:xfrm><a:off x="640436" y="458979"/><a:ext cx="300" cy="400"/></a:xfrm><a:prstGeom prst="rect"/></wps:spPr>
            </wps:wsp>
          </wpg:wgp>
        </a:graphicData></a:graphic>
      </wp:anchor>
    </w:drawing></w:r></w:p></w:body>`);
    const frames = parseAnchoredFrames(doc, emptyCtx);
    const g = frames[0]!.content as Extract<(typeof frames)[0]["content"], { kind: "group" }>;
    expect(g.childCoordOffsetX).toBe(640436);
    expect(g.childCoordOffsetY).toBe(458979);
  });

  it("omits a zero <a:chOff> origin (stays absent in the AST)", () => {
    const doc = xml(`<w:body><w:p><w:r><w:drawing>
      <wp:anchor>
        <wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>
        <wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>
        <wp:extent cx="1000" cy="1000"/>
        <a:graphic><a:graphicData>
          <wpg:wgp>
            <wpg:grpSpPr><a:xfrm><a:chExt cx="2000" cy="2000"/></a:xfrm></wpg:grpSpPr>
            <wps:wsp>
              <wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="300" cy="400"/></a:xfrm><a:prstGeom prst="rect"/></wps:spPr>
            </wps:wsp>
          </wpg:wgp>
        </a:graphicData></a:graphic>
      </wp:anchor>
    </w:drawing></w:r></w:p></w:body>`);
    const frames = parseAnchoredFrames(doc, emptyCtx);
    const g = frames[0]!.content as Extract<(typeof frames)[0]["content"], { kind: "group" }>;
    expect(g.childCoordOffsetX).toBeUndefined();
    expect(g.childCoordOffsetY).toBeUndefined();
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

describe("parseVmlFloatingFrames", () => {
  const watermark = (style: string) => `
    <w:p><w:r><w:pict>
      <v:shape id="wm" type="#_x0000_t75" style="${style}">
        <v:imagedata r:id="rId9"/>
      </v:shape>
    </w:pict></w:r></w:p>`;

  it("parses a position:absolute VML watermark into a behind-text picture frame", () => {
    const doc = xml(
      watermark(
        "position:absolute;margin-left:0;margin-top:0;width:575.55pt;height:744.85pt;z-index:-251657216;mso-position-horizontal-relative:margin;mso-position-vertical-relative:margin",
      ),
    );
    const rels = new Map([["rId9", "media/image2.png"]]);
    const frames = parseVmlFloatingFrames(doc, { rels });
    expect(frames).toHaveLength(1);
    const f = frames[0]!;
    expect(f.content).toEqual({ kind: "picture", partPath: "word/media/image2.png" });
    expect(f.behindText).toBe(true);
    expect(f.anchor.horizontalFrom).toBe("margin");
    expect(f.anchor.verticalFrom).toBe("margin");
    // 575.55pt * 12700 EMU/pt
    expect(f.widthEmu).toBe(Math.round(575.55 * 12700));
    expect(f.heightEmu).toBe(Math.round(744.85 * 12700));
  });

  it("claims (removes) the <w:pict> so the flow walker can't double-render it", () => {
    const doc = xml(watermark("position:absolute;width:100pt;height:100pt"));
    expect(doc.getElementsByTagName("w:pict")).toHaveLength(1);
    parseVmlFloatingFrames(doc, { rels: new Map([["rId9", "media/image2.png"]]) });
    expect(doc.getElementsByTagName("w:pict")).toHaveLength(0);
  });

  it("leaves the XML intact when claim=false", () => {
    const doc = xml(watermark("position:absolute;width:100pt;height:100pt"));
    parseVmlFloatingFrames(doc, { rels: new Map([["rId9", "media/image2.png"]]) }, false);
    expect(doc.getElementsByTagName("w:pict")).toHaveLength(1);
  });

  it("ignores INLINE VML (no position:absolute) — runs.ts renders those in flow", () => {
    const doc = xml(watermark("width:100pt;height:100pt"));
    expect(parseVmlFloatingFrames(doc, { rels: new Map([["rId9", "media/image2.png"]]) })).toEqual(
      [],
    );
  });

  it("is not behind-text when z-index is positive", () => {
    const doc = xml(watermark("position:absolute;width:50pt;height:50pt;z-index:5"));
    const f = parseVmlFloatingFrames(doc, { rels: new Map([["rId9", "media/image2.png"]]) })[0]!;
    expect(f.behindText).toBeUndefined();
  });

  it("skips a float whose image rId has no rels target", () => {
    const doc = xml(watermark("position:absolute;width:50pt;height:50pt"));
    expect(parseVmlFloatingFrames(doc, { rels: new Map() })).toEqual([]);
  });
});
