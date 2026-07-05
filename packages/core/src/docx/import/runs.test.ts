import { describe, expect, it } from "vitest";
import { readRun, readRunSegments } from "./runs";

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function runFromXml(xml: string): Element {
  return new DOMParser().parseFromString(xml, "application/xml").documentElement;
}

describe("readRun — toggle properties keep their explicit value", () => {
  it('bare <w:caps/> is true; <w:caps w:val="0"/> is an explicit false', () => {
    const on = readRun(
      runFromXml(`<w:r xmlns:w="${NS_W}"><w:rPr><w:caps/></w:rPr><w:t>x</w:t></w:r>`),
    );
    expect(on.format.caps).toBe(true);
    // The explicit false is load-bearing: it must override an inherited toggle.
    const off = readRun(
      runFromXml(`<w:r xmlns:w="${NS_W}"><w:rPr><w:caps w:val="0"/></w:rPr><w:t>x</w:t></w:r>`),
    );
    expect(off.format.caps).toBe(false);
    // Absent element → unspecified, not false.
    const none = readRun(runFromXml(`<w:r xmlns:w="${NS_W}"><w:t>x</w:t></w:r>`));
    expect(none.format.caps).toBeUndefined();
  });
});

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
    expect(parsed.drawing?.srcRect).toBeUndefined();
  });

  it("reads the <a:srcRect> source crop as 0-1 fractions", () => {
    // ljmu letterhead: the header PNG holds two logos side by side and
    // the drawing crops to the LJMU mark (left 3.048%, right 59.274%).
    const r = runFromXml(`<?xml version="1.0"?>
      <w:r xmlns:w="${NS_W}" xmlns:wp="${NS_WP}" xmlns:r="${NS_R}">
        <w:drawing>
          <wp:inline>
            <wp:extent cx="2939143" cy="1533448"/>
            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:graphicData>
                <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                  <pic:blipFill>
                    <a:blip r:embed="rId1"/>
                    <a:srcRect l="3048" r="59274"/>
                  </pic:blipFill>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>`);
    const parsed = readRun(r);
    expect(parsed.drawing?.srcRect).toEqual({ l: 0.03048, r: 0.59274 });
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
    expect(parsed.footnoteCustomMark).toBeUndefined();
  });

  it("captures the custom mark from <w:footnoteReference w:customMarkFollows>", () => {
    // The mark trails the reference as plain text in the SAME run.
    const r = runFromXml(`<?xml version="1.0"?>
      <w:r xmlns:w="${NS_W}">
        <w:footnoteReference w:customMarkFollows="1" w:id="1"/>
        <w:t>*</w:t>
      </w:r>`);
    const parsed = readRun(r);
    expect(parsed.footnoteRefId).toBe(1);
    expect(parsed.footnoteCustomMark).toBe("*");
    // The mark text is consumed by the reference, not emitted as body text.
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

describe("readRunSegments — <w:br/> is run content, not a run type", () => {
  it("splits a mixed run into break + text, keeping the shared rPr", () => {
    // Word emits this when the author types Shift-Enter mid-sentence and
    // keeps typing: `Lancaster University, UK` ⏎ `First-class honours`.
    // The old single-run contract early-returned on the <w:br/> and
    // dropped "First-class " entirely.
    const r = runFromXml(
      `<w:r xmlns:w="${NS_W}"><w:rPr><w:color w:val="564B3C"/></w:rPr><w:br/><w:t xml:space="preserve">First-class </w:t></w:r>`,
    );
    const segs = readRunSegments(r);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ isHardBreak: true, breakType: "line" });
    expect(segs[1]).toMatchObject({ isHardBreak: false, text: "First-class " });
    expect(segs[1]?.format.color).toBe("#564B3C");
  });

  it("text before AND after a page break both survive, in order", () => {
    const r = runFromXml(
      `<w:r xmlns:w="${NS_W}"><w:t>before</w:t><w:br w:type="page"/><w:t>after</w:t></w:r>`,
    );
    const segs = readRunSegments(r);
    expect(segs.map((s) => (s.isHardBreak ? `[${s.breakType}]` : s.text))).toEqual([
      "before",
      "[page]",
      "after",
    ]);
  });

  it("a break-only run stays a single break segment", () => {
    const r = runFromXml(`<w:r xmlns:w="${NS_W}"><w:br w:type="column"/></w:r>`);
    const segs = readRunSegments(r);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ isHardBreak: true, breakType: "column" });
  });
});

describe("readRun — <w:sym> symbol-font glyphs", () => {
  it("maps Wingdings F071 to the ❑ checkbox glyph", () => {
    const r = runFromXml(
      `<w:r xmlns:w="${NS_W}"><w:sym w:font="Wingdings" w:char="F071"/><w:t xml:space="preserve"> #1 No Cook</w:t></w:r>`,
    );
    expect(readRun(r).text).toBe("❑ #1 No Cook");
  });

  it("unmapped symbol codes fall back to the raw codepoint", () => {
    const r = runFromXml(`<w:r xmlns:w="${NS_W}"><w:sym w:font="Webdings" w:char="F0E8"/></w:r>`);
    expect(readRun(r).text).toBe(String.fromCodePoint(0xf0e8));
  });
});

describe("normaliseRunText — whitespace passes through verbatim", () => {
  it("keeps long space runs (layout spaces push labels right)", () => {
    const r = runFromXml(
      `<w:r xmlns:w="${NS_W}"><w:t xml:space="preserve">${" ".repeat(40)}</w:t></w:r>`,
    );
    expect(readRun(r).text).toBe(" ".repeat(40));
  });
});
