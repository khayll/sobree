import { describe, expect, it } from "vitest";
import type { Block } from "../../doc/types";
import { parseAnchoredFrames } from "./anchored";
import { parseInlineFrames } from "./inline";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function xml(source: string): Document {
  const wrapped = `<?xml version="1.0" encoding="UTF-8"?>
<w:document
  xmlns:w="${W_NS}"
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

function stubBody(txbxContent: Element): Block[] {
  const out: Block[] = [];
  for (const child of Array.from(txbxContent.children)) {
    if (child.namespaceURI === W_NS && child.localName === "p") {
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

const ctx = { rels: new Map<string, string>(), parseBlockBody: stubBody };

/** An inline single-textbox group whose textbox carries the given
 *  `<wps:bodyPr …>` attributes (pass "" for a bare/absent bodyPr). */
function inlineTextbox(bodyPrAttrs: string | null): Document {
  const bodyPr = bodyPrAttrs === null ? "" : `<wps:bodyPr ${bodyPrAttrs}/>`;
  return xml(`<w:body><w:p><w:r><w:drawing>
    <wp:inline>
      <wp:extent cx="5000000" cy="500000"/>
      <a:graphic><a:graphicData>
        <wpg:wgp>
          <wpg:grpSpPr><a:xfrm><a:ext cx="5000000" cy="500000"/><a:chExt cx="5000000" cy="500000"/></a:xfrm></wpg:grpSpPr>
          <wps:wsp>
            <wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="300000"/></a:xfrm></wps:spPr>
            <wps:txbx><w:txbxContent><w:p>Hi</w:p></w:txbxContent></wps:txbx>
            ${bodyPr}
          </wps:wsp>
        </wpg:wgp>
      </a:graphicData></a:graphic>
    </wp:inline>
  </w:drawing></w:r></w:p></w:body>`);
}

describe("inline textbox — bodyPr insets and vertical anchor", () => {
  it("reads explicit insets as padding and anchor=ctr as vAlign center", () => {
    const f = parseInlineFrames(
      inlineTextbox(`anchor="ctr" lIns="12700" tIns="6350" rIns="12700" bIns="6350"`),
      ctx,
    )[0]!.frame;
    expect(f.textboxes[0]?.padding).toEqual({
      leftEmu: 12700,
      topEmu: 6350,
      rightEmu: 12700,
      bottomEmu: 6350,
    });
    expect(f.textboxes[0]?.vAlign).toBe("center");
  });

  it("falls back to Word's default insets for omitted sides, anchor=b ⇒ bottom", () => {
    const f = parseInlineFrames(inlineTextbox(`anchor="b" lIns="0"`), ctx)[0]!.frame;
    // lIns explicit 0; the other three fall back to the OOXML defaults.
    expect(f.textboxes[0]?.padding).toEqual({
      leftEmu: 0,
      topEmu: 45720,
      rightEmu: 91440,
      bottomEmu: 45720,
    });
    expect(f.textboxes[0]?.vAlign).toBe("bottom");
  });

  it("defaults vAlign to top when no anchor attribute is present", () => {
    const f = parseInlineFrames(inlineTextbox(`lIns="0"`), ctx)[0]!.frame;
    expect(f.textboxes[0]?.vAlign).toBe("top");
  });

  it("leaves padding/vAlign undefined when there is no <wps:bodyPr>", () => {
    const f = parseInlineFrames(inlineTextbox(null), ctx)[0]!.frame;
    expect(f.textboxes[0]?.padding).toBeUndefined();
    expect(f.textboxes[0]?.vAlign).toBeUndefined();
  });
});

/** An anchored single-textbox frame whose textbox carries the given
 *  `<wps:bodyPr …>` attributes (pass null for no bodyPr). */
function anchoredTextbox(bodyPrAttrs: string | null): Document {
  const bodyPr = bodyPrAttrs === null ? "" : `<wps:bodyPr ${bodyPrAttrs}/>`;
  return xml(`<w:body><w:p><w:r><w:drawing>
    <wp:anchor>
      <wp:extent cx="2000000" cy="1000000"/>
      <a:graphic><a:graphicData>
        <wps:wsp>
          <wps:spPr><a:prstGeom prst="rect"/></wps:spPr>
          <wps:txbx><w:txbxContent><w:p>Boxed</w:p></w:txbxContent></wps:txbx>
          ${bodyPr}
        </wps:wsp>
      </a:graphicData></a:graphic>
    </wp:anchor>
  </w:drawing></w:r></w:p></w:body>`);
}

describe("anchored textbox — bodyPr insets", () => {
  it("zero-fills omitted sides with Word defaults when at least one inset is declared", () => {
    const frames = parseAnchoredFrames(anchoredTextbox(`lIns="25400"`), ctx, false);
    const content = frames[0]!.content;
    expect(content.kind).toBe("textbox");
    if (content.kind !== "textbox") return;
    expect(content.padding).toEqual({
      leftEmu: 25400,
      topEmu: 45720,
      rightEmu: 91440,
      bottomEmu: 45720,
    });
  });

  it("leaves padding undefined when <wps:bodyPr> has no inset attributes", () => {
    const frames = parseAnchoredFrames(anchoredTextbox(""), ctx, false);
    const content = frames[0]!.content;
    if (content.kind !== "textbox") throw new Error("expected textbox");
    expect(content.padding).toBeUndefined();
  });
});
