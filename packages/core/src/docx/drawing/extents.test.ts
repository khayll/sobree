import { describe, expect, it } from "vitest";
import { emuAttr, numAttr, numAttrOr, readExtent } from "./extents";
import { el } from "./testUtil";

describe("extents — numeric attribute readers", () => {
  it("numAttr reads a finite attribute", () => {
    expect(numAttr(el(`<a:ext cx="914400" cy="635000"/>`), "cx")).toBe(914400);
  });

  it("numAttr returns 0 for absent / null element / non-finite", () => {
    expect(numAttr(el("<a:ext/>"), "cx")).toBe(0);
    expect(numAttr(null, "cx")).toBe(0);
    expect(numAttr(undefined, "cx")).toBe(0);
    expect(numAttr(el(`<a:ext cx="NaNish"/>`), "cx")).toBe(0);
  });

  it("numAttrOr falls back only when the attribute is ABSENT", () => {
    expect(numAttrOr(el("<wps:bodyPr/>"), "lIns", 91440)).toBe(91440);
    expect(numAttrOr(el(`<wps:bodyPr lIns="0"/>`), "lIns", 91440)).toBe(0);
    expect(numAttrOr(el(`<wps:bodyPr lIns="12700"/>`), "lIns", 91440)).toBe(12700);
  });

  it("emuAttr maps a null attribute string to 0", () => {
    expect(emuAttr(null)).toBe(0);
    expect(emuAttr("45720")).toBe(45720);
    expect(emuAttr("bogus")).toBe(0);
  });

  it("readExtent reads cx/cy into an EmuExtent", () => {
    expect(readExtent(el(`<wp:extent cx="914400" cy="685800"/>`))).toEqual({
      cx: 914400,
      cy: 685800,
    });
    expect(readExtent(null)).toEqual({ cx: 0, cy: 0 });
  });
});
