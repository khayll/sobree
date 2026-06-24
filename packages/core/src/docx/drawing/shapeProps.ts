/**
 * Owns DrawingML shape/graphic properties: preset geometry
 * (`<a:prstGeom>`), solid fill, and outline (`<a:ln>`) — the visible
 * chrome of a shape or textbox. Colour resolution itself lives in
 * `colors.ts`; this module reads the `<…:spPr>` structure and turns it
 * into the AST's `fill` string / `FrameBorder`.
 */

import type { FrameBorder } from "../../doc/types";
import { NS } from "../shared/namespaces";
import { type ThemePalette, readDrawingColor } from "./colors";
import { firstChildNS } from "./dom";
import { numAttr } from "./extents";

/** Map `<a:prstGeom prst>` to the AST's preset geometry enum; unknown
 *  presets fall back to `rect`. (Custom geometry is handled separately by
 *  the anchored reader via `customGeometry`.) */
export function readGeometry(wsp: Element): "rect" | "ellipse" | "roundedRect" | "line" {
  const prstGeom = wsp.getElementsByTagNameNS(NS.a, "prstGeom")[0];
  const prst = prstGeom?.getAttribute("prst");
  switch (prst) {
    case "ellipse":
      return "ellipse";
    case "roundRect":
      return "roundedRect";
    case "line":
    case "straightConnector1":
      return "line";
    default:
      return "rect";
  }
}

/**
 * First `<a:solidFill>` directly inside the shape's `spPr` (wps or pic) —
 * literal `srgbClr` or theme `schemeClr` (+ transforms), resolved by
 * `readDrawingColor`. Direct-child traversal so a fill nested deeper
 * inside a child shape isn't picked up by mistake.
 */
export function readSolidFill(shape: Element, theme?: ThemePalette): string | undefined {
  const spPr = firstChildNS(shape, NS.wps, "spPr") ?? firstChildNS(shape, NS.pic, "spPr");
  if (!spPr) return undefined;
  for (const fill of Array.from(spPr.children)) {
    if (fill.namespaceURI === NS.a && fill.localName === "solidFill") {
      return readDrawingColor(fill, theme);
    }
  }
  return undefined;
}

/** Read the shape outline `<a:ln>` (width + colour + dash) into a
 *  `FrameBorder`; `undefined` when there's no outline or no stroke colour. */
export function readBorder(shape: Element, theme?: ThemePalette): FrameBorder | undefined {
  const spPr = firstChildNS(shape, NS.wps, "spPr") ?? firstChildNS(shape, NS.pic, "spPr");
  if (!spPr) return undefined;
  const ln = firstChildNS(spPr, NS.a, "ln");
  if (!ln) return undefined;
  const widthEmu = numAttr(ln, "w");
  const solidFill = firstChildNS(ln, NS.a, "solidFill");
  const color = solidFill ? readDrawingColor(solidFill, theme) : undefined;
  if (!color) return undefined;
  const prstDash = firstChildNS(ln, NS.a, "prstDash");
  const style = coerceBorderStyle(prstDash?.getAttribute("val"));
  return { color, widthEmu: widthEmu || 0, style };
}

function coerceBorderStyle(v: string | null | undefined): FrameBorder["style"] {
  switch (v) {
    case "dash":
    case "lgDash":
    case "sysDash":
      return "dashed";
    case "dot":
    case "sysDot":
      return "dotted";
    default:
      return "solid";
  }
}
