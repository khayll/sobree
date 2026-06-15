import { describe, expect, it } from "vitest";

import { parseCustomGeometry } from "./customGeometry";

/** Parse a `<a:custGeom>` fragment and return its element. */
function custGeom(inner: string): Element {
  const doc = new DOMParser().parseFromString(
    `<a:custGeom xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${inner}</a:custGeom>`,
    "application/xml",
  );
  return doc.documentElement;
}

describe("parseCustomGeometry", () => {
  it("translates move / line / cubic / close into an SVG path", () => {
    const el = custGeom(`
      <a:pathLst>
        <a:path w="100" h="200">
          <a:moveTo><a:pt x="10" y="20"/></a:moveTo>
          <a:lnTo><a:pt x="90" y="20"/></a:lnTo>
          <a:cubicBezTo><a:pt x="95" y="40"/><a:pt x="95" y="60"/><a:pt x="90" y="80"/></a:cubicBezTo>
          <a:close/>
        </a:path>
      </a:pathLst>
    `);
    expect(parseCustomGeometry(el)).toEqual({
      widthEmu: 100,
      heightEmu: 200,
      d: "M 10 20 L 90 20 C 95 40 95 60 90 80 Z",
    });
  });

  it("emits multiple subpaths in one `d` so even-odd fill punches holes", () => {
    // An "O": an outer ring then an inner counter, each its own M…Z.
    const el = custGeom(`
      <a:pathLst>
        <a:path w="100" h="100">
          <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
          <a:lnTo><a:pt x="100" y="0"/></a:lnTo>
          <a:close/>
          <a:moveTo><a:pt x="25" y="25"/></a:moveTo>
          <a:lnTo><a:pt x="75" y="25"/></a:lnTo>
          <a:close/>
        </a:path>
      </a:pathLst>
    `);
    expect(parseCustomGeometry(el)?.d).toBe("M 0 0 L 100 0 Z M 25 25 L 75 25 Z");
  });

  it("skips unsupported commands (e.g. arcTo) without aborting the path", () => {
    const el = custGeom(`
      <a:pathLst>
        <a:path w="100" h="100">
          <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
          <a:arcTo wR="10" hR="10" stAng="0" swAng="5400000"/>
          <a:lnTo><a:pt x="50" y="50"/></a:lnTo>
        </a:path>
      </a:pathLst>
    `);
    expect(parseCustomGeometry(el)?.d).toBe("M 0 0 L 50 50");
  });

  it("returns null when there is no usable outline", () => {
    expect(parseCustomGeometry(custGeom(`<a:avLst/>`))).toBeNull();
    expect(parseCustomGeometry(custGeom(`<a:pathLst/>`))).toBeNull();
    // Zero-area box.
    expect(
      parseCustomGeometry(
        custGeom(`<a:pathLst><a:path w="0" h="0"><a:close/></a:path></a:pathLst>`),
      ),
    ).toBeNull();
  });
});
