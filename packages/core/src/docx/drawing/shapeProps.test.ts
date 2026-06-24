import { describe, expect, it } from "vitest";
import { readBorder, readGeometry, readSolidFill } from "./shapeProps";
import { el } from "./testUtil";

describe("shapeProps — geometry", () => {
  it("maps preset geometries, defaulting unknown to rect", () => {
    const geom = (prst: string) =>
      readGeometry(el(`<wps:wsp><wps:spPr><a:prstGeom prst="${prst}"/></wps:spPr></wps:wsp>`));
    expect(geom("ellipse")).toBe("ellipse");
    expect(geom("roundRect")).toBe("roundedRect");
    expect(geom("line")).toBe("line");
    expect(geom("straightConnector1")).toBe("line");
    expect(geom("rect")).toBe("rect");
    expect(geom("hexagon")).toBe("rect");
  });
});

describe("shapeProps — solid fill", () => {
  it("reads a literal srgbClr fill directly under spPr", () => {
    const wsp = el(
      `<wps:wsp><wps:spPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></wps:spPr></wps:wsp>`,
    );
    expect(readSolidFill(wsp)).toBe("#FF0000");
  });

  it("returns undefined when there is no spPr or no fill", () => {
    expect(readSolidFill(el("<wps:wsp/>"))).toBeUndefined();
    expect(readSolidFill(el("<wps:wsp><wps:spPr/></wps:wsp>"))).toBeUndefined();
  });
});

describe("shapeProps — border", () => {
  it("reads outline width, colour and dash style", () => {
    const wsp = el(
      `<wps:wsp><wps:spPr><a:ln w="12700"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill><a:prstDash val="dash"/></a:ln></wps:spPr></wps:wsp>`,
    );
    expect(readBorder(wsp)).toEqual({ color: "#0000FF", widthEmu: 12700, style: "dashed" });
  });

  it("defaults dash style to solid and tolerates a missing width", () => {
    const wsp = el(
      `<wps:wsp><wps:spPr><a:ln><a:solidFill><a:srgbClr val="00AA00"/></a:solidFill></a:ln></wps:spPr></wps:wsp>`,
    );
    expect(readBorder(wsp)).toEqual({ color: "#00AA00", widthEmu: 0, style: "solid" });
  });

  it("returns undefined when there is no outline or no stroke colour", () => {
    expect(readBorder(el("<wps:wsp><wps:spPr/></wps:wsp>"))).toBeUndefined();
    expect(
      readBorder(el(`<wps:wsp><wps:spPr><a:ln w="9525"/></wps:spPr></wps:wsp>`)),
    ).toBeUndefined();
  });
});
