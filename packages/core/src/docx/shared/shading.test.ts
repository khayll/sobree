import { describe, expect, it } from "vitest";
import { readShading } from "./shading";
import { parseXml, wFirst } from "./xml";
import { NS } from "./namespaces";

/** Parse a `<w:tcPr>`-style parent and return the element to feed readShading. */
function parentWith(shdAttrs: string): Element {
  const doc = parseXml(
    `<w:tcPr xmlns:w="${NS.w}">${shdAttrs ? `<w:shd ${shdAttrs}/>` : ""}</w:tcPr>`,
  );
  return doc.documentElement;
}

describe("readShading", () => {
  it("reads fill into a #-prefixed Shading with default clear pattern", () => {
    const shd = readShading(parentWith('w:fill="FF0000"'));
    expect(shd).toEqual({ pattern: "clear", fill: "#FF0000" });
  });

  it("carries the w:val pattern when present", () => {
    const shd = readShading(parentWith('w:val="solid" w:fill="00FF00"'));
    expect(shd).toEqual({ pattern: "solid", fill: "#00FF00" });
  });

  it("reads the optional color attribute, # prefixing it", () => {
    const shd = readShading(parentWith('w:fill="FFFFFF" w:color="123456"'));
    expect(shd).toEqual({ pattern: "clear", fill: "#FFFFFF", color: "#123456" });
  });

  it("preserves an already #-prefixed fill", () => {
    const shd = readShading(parentWith('w:fill="#ABCDEF"'));
    expect(shd?.fill).toBe("#ABCDEF");
  });

  it("returns undefined when no <w:shd> element is present", () => {
    expect(readShading(parentWith(""))).toBeUndefined();
  });

  it("returns undefined when fill is missing", () => {
    expect(readShading(parentWith('w:val="clear"'))).toBeUndefined();
  });

  it("returns undefined when fill is auto", () => {
    expect(readShading(parentWith('w:fill="auto"'))).toBeUndefined();
  });

  it("omits color when color is auto", () => {
    const shd = readShading(parentWith('w:fill="FF0000" w:color="auto"'));
    expect(shd).toEqual({ pattern: "clear", fill: "#FF0000" });
    expect(shd).not.toHaveProperty("color");
  });

  it("finds shd nested inside the parent (not only direct child)", () => {
    const doc = parseXml(
      `<w:pPr xmlns:w="${NS.w}"><w:rPr><w:shd w:fill="0000FF"/></w:rPr></w:pPr>`,
    );
    expect(wFirst(doc, "shd")).not.toBeNull();
    expect(readShading(doc.documentElement)?.fill).toBe("#0000FF");
  });
});
