import { describe, expect, it } from "vitest";
import { readRun } from "./runs";

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function runFromXml(xml: string): Element {
  return new DOMParser().parseFromString(xml, "application/xml").documentElement;
}

describe("readRun — <w:drawing>", () => {
  it("flags inline drawings without an anchor", () => {
    const r = runFromXml(`<?xml version="1.0"?>
      <w:r xmlns:w="${NS_W}" xmlns:wp="${NS_WP}" xmlns:r="${NS_R}">
        <w:drawing>
          <wp:inline>
            <wp:extent cx="914400" cy="914400"/>
            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:graphicData>
                <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                  <pic:blipFill>
                    <a:blip r:embed="rId1"/>
                  </pic:blipFill>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>`);
    const parsed = readRun(r);
    expect(parsed.drawing?.embedRelId).toBe("rId1");
    expect(parsed.drawing?.widthEmu).toBe(914400);
    expect(parsed.drawing?.anchor).toBeUndefined();
  });

  it("skips <wp:anchor> drawings — handled by the per-page anchor layer", () => {
    // Anchored content is now parsed by `parseAnchoredFrames` into
    // `SobreeDocument.anchoredFrames` and painted by `renderAnchorLayer`
    // as a per-page overlay. readRun returns an empty run (no
    // `drawing` field) so the inline renderer doesn't paint a
    // duplicate full-extent image inside body flow.
    const r = runFromXml(`<?xml version="1.0"?>
      <w:r xmlns:w="${NS_W}" xmlns:wp="${NS_WP}" xmlns:r="${NS_R}">
        <w:drawing>
          <wp:anchor behindDoc="1">
            <wp:positionH relativeFrom="page">
              <wp:posOffset>2540000</wp:posOffset>
            </wp:positionH>
            <wp:positionV relativeFrom="margin">
              <wp:posOffset>1270000</wp:posOffset>
            </wp:positionV>
            <wp:extent cx="2000000" cy="1500000"/>
            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:graphicData>
                <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                  <pic:blipFill>
                    <a:blip r:embed="rId7"/>
                  </pic:blipFill>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:anchor>
        </w:drawing>
      </w:r>`);
    const parsed = readRun(r);
    expect(parsed.text).toBe("");
    expect(parsed.drawing).toBeUndefined();
  });

  it("reads <w:commentReference> into commentRefId", () => {
    const r = runFromXml(`<?xml version="1.0"?>
      <w:r xmlns:w="${NS_W}">
        <w:commentReference w:id="3"/>
      </w:r>`);
    const parsed = readRun(r);
    expect(parsed.commentRefId).toBe(3);
    expect(parsed.text).toBe("");
  });

  it("reads <w:footnoteReference> into footnoteRefId", () => {
    const r = runFromXml(`<?xml version="1.0"?>
      <w:r xmlns:w="${NS_W}">
        <w:footnoteReference w:id="7"/>
      </w:r>`);
    const parsed = readRun(r);
    expect(parsed.footnoteRefId).toBe(7);
    expect(parsed.text).toBe("");
  });

  it("skips uncommon-relativeFrom anchored drawings too", () => {
    // Same skip applies regardless of which `relativeFrom` the anchor
    // uses — the new layer reads coordinate origins itself in
    // `parseAnchoredFrames`. Body-run rendering stays oblivious.
    const r = runFromXml(`<?xml version="1.0"?>
      <w:r xmlns:w="${NS_W}" xmlns:wp="${NS_WP}" xmlns:r="${NS_R}">
        <w:drawing>
          <wp:anchor>
            <wp:positionH relativeFrom="leftMargin">
              <wp:posOffset>0</wp:posOffset>
            </wp:positionH>
            <wp:positionV relativeFrom="topMargin">
              <wp:posOffset>0</wp:posOffset>
            </wp:positionV>
            <wp:extent cx="100000" cy="100000"/>
            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:graphicData>
                <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                  <pic:blipFill>
                    <a:blip r:embed="rId2"/>
                  </pic:blipFill>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:anchor>
        </w:drawing>
      </w:r>`);
    const parsed = readRun(r);
    expect(parsed.drawing).toBeUndefined();
  });
});
