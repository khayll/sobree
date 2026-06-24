import { describe, expect, it } from "vitest";
import { parseThemeXml, readDrawingColor } from "./colors";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";

const THEME = `<?xml version="1.0"?>
<a:theme xmlns:a="${A}"><a:themeElements><a:clrScheme name="t">
  <a:dk1><a:srgbClr val="000000"/></a:dk1>
  <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
  <a:accent1><a:srgbClr val="85B9C9"/></a:accent1>
</a:clrScheme></a:themeElements></a:theme>`;

const el = (inner: string): Element =>
  new DOMParser().parseFromString(
    `<a:solidFill xmlns:a="${A}">${inner}</a:solidFill>`,
    "application/xml",
  ).documentElement;

describe("drawingColor", () => {
  const theme = parseThemeXml(THEME)!;

  it("parses the clrScheme palette (srgbClr and sysClr lastClr)", () => {
    expect(theme.accent1).toBe("#85B9C9");
    expect(theme.lt1).toBe("#FFFFFF");
  });

  it("reads literal srgbClr without a theme", () => {
    expect(readDrawingColor(el(`<a:srgbClr val="367DA2"/>`))).toBe("#367DA2");
  });

  it("resolves schemeClr + hue/sat/lum offsets (the header-rule case)", () => {
    // accent1 #85B9C9 with the offsets a real CV's 1pt rule carries —
    // must land on the document blue (±1/channel from HSL rounding).
    const c = readDrawingColor(
      el(
        `<a:schemeClr val="accent1"><a:hueOff val="366345"/><a:satOff val="11385"/><a:lumOff val="-23239"/></a:schemeClr>`,
      ),
      theme,
    )!;
    const ch = (i: number): number => Number.parseInt(c.slice(i, i + 2), 16);
    expect(Math.abs(ch(1) - 0x36)).toBeLessThanOrEqual(2);
    expect(Math.abs(ch(3) - 0x7d)).toBeLessThanOrEqual(2);
    expect(Math.abs(ch(5) - 0xa2)).toBeLessThanOrEqual(2);
  });

  it("maps tx/bg aliases and applies lumMod/shade", () => {
    expect(readDrawingColor(el(`<a:schemeClr val="bg1"/>`), theme)).toBe("#FFFFFF");
    // 50% shade of white = mid-gray.
    expect(
      readDrawingColor(el(`<a:schemeClr val="bg1"><a:shade val="50000"/></a:schemeClr>`), theme),
    ).toBe("#808080");
  });

  it("returns undefined for schemeClr with no palette", () => {
    expect(readDrawingColor(el(`<a:schemeClr val="accent1"/>`))).toBeUndefined();
  });
});
