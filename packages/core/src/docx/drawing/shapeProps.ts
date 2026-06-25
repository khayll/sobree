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
 *  presets fall back to `rect`. Only the box-expressible presets live
 *  here — those a CSS rectangle (± border-radius) can draw. Presets that
 *  need a real outline (arrows, callouts) are expanded to an SVG path by
 *  `presetGeometry`, and `<a:custGeom>` by `customGeometry`. */
export function readGeometry(wsp: Element): "rect" | "ellipse" | "roundedRect" | "line" {
  const prstGeom = wsp.getElementsByTagNameNS(NS.a, "prstGeom")[0];
  const prst = prstGeom?.getAttribute("prst");
  switch (prst) {
    case "ellipse":
      return "ellipse";
    case "roundRect":
    // `round2SameRect` rounds only the two top corners; we approximate it
    // with an all-corners rounded rect — close enough for banners, and a
    // CSS box can't express "two corners" without a path anyway.
    case "round2SameRect":
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
  if (spPr) {
    for (const fill of Array.from(spPr.children)) {
      if (fill.namespaceURI === NS.a && fill.localName === "solidFill") {
        return readDrawingColor(fill, theme);
      }
    }
  }
  // No DIRECT fill: fall back to the shape-STYLE reference. Word's shape
  // gallery records a shape's fill nowhere in `spPr` — only as
  // `<wps:style><a:fillRef idx>` (a slot in the theme's fill-style list)
  // plus the colour to tint that slot with. This is the default for any
  // shape inserted from the ribbon; without it every gallery shape (the
  // black step banner, the header pills, the footer arrow) imports
  // fill-less and renders invisible.
  return readStyleRefFill(shape, theme);
}

/**
 * Resolve a shape's fill from its `<wps:style><a:fillRef>`. `idx="0"` is
 * the theme's explicit "no fill" slot → undefined; any other slot we
 * model as a solid fill of the referenced colour (idx 1 = the solidFill
 * entry, which is what the ribbon emits). The `<a:schemeClr>` /
 * `<a:srgbClr>` child carries the colour, resolved by `readDrawingColor`.
 */
function readStyleRefFill(shape: Element, theme?: ThemePalette): string | undefined {
  const style = firstChildNS(shape, NS.wps, "style");
  if (!style) return undefined;
  const fillRef = firstChildNS(style, NS.a, "fillRef");
  if (!fillRef || fillRef.getAttribute("idx") === "0") return undefined;
  return readDrawingColor(fillRef, theme);
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
