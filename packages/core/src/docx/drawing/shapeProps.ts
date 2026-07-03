/**
 * Owns DrawingML shape/graphic properties: preset geometry
 * (`<a:prstGeom>`), solid fill, and outline (`<a:ln>`) — the visible
 * chrome of a shape or textbox. Colour resolution itself lives in
 * `colors.ts`; this module reads the `<…:spPr>` structure and turns it
 * into the AST's `fill` string / `FrameBorder`.
 */

import type { FrameBorder } from "../../doc/types";
import { NS } from "../shared/namespaces";
import {
  type ThemeFillStyles,
  type ThemePalette,
  readDrawingColor,
  resolveThemeFillEntry,
} from "./colors";
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
export function readSolidFill(
  shape: Element,
  theme?: ThemePalette,
  themeFillStyles?: ThemeFillStyles,
): string | undefined {
  const spPr = firstChildNS(shape, NS.wps, "spPr") ?? firstChildNS(shape, NS.pic, "spPr");
  if (spPr) {
    for (const fill of Array.from(spPr.children)) {
      if (fill.namespaceURI !== NS.a) continue;
      if (fill.localName === "solidFill") {
        return readDrawingColor(fill, theme);
      }
      // Explicit `<a:noFill/>` OVERRIDES the style fillRef (ECMA-376
      // §20.1.4.1.14 — direct spPr fill wins over the style reference).
      // Falling through painted outline-only frame shapes with the
      // gallery's default white fill, covering everything behind them.
      if (fill.localName === "noFill") {
        return undefined;
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
  return readStyleRefFill(shape, theme, themeFillStyles);
}

/**
 * Resolve a shape's fill from its `<wps:style><a:fillRef>`. `idx="0"` is
 * the theme's explicit "no fill" slot → undefined. Any other idx selects
 * a theme fill-style entry (§20.1.4.1.14): 1-999 index `fillStyleLst`,
 * ≥1001 index `bgFillStyleLst` (idx-1000), and the fillRef's own colour
 * child is the entry's `phClr` placeholder. When the theme lists aren't
 * available, fall back to a solid of the ref colour — right for idx 1
 * (the ribbon default, a plain `solidFill phClr` template), a flattening
 * for the rest.
 */
function readStyleRefFill(
  shape: Element,
  theme?: ThemePalette,
  themeFillStyles?: ThemeFillStyles,
): string | undefined {
  const style = firstChildNS(shape, NS.wps, "style");
  if (!style) return undefined;
  const fillRef = firstChildNS(style, NS.a, "fillRef");
  if (!fillRef) return undefined;
  const idx = Number.parseInt(fillRef.getAttribute("idx") ?? "0", 10);
  if (!Number.isFinite(idx) || idx <= 0) return undefined;
  const phClr = readDrawingColor(fillRef, theme);
  if (themeFillStyles && phClr) {
    const entry = idx >= 1001 ? themeFillStyles.bg[idx - 1001] : themeFillStyles.fill[idx - 1];
    if (entry) {
      const resolved = resolveThemeFillEntry(entry, theme, phClr);
      if (resolved !== undefined) return resolved;
    }
  }
  return phClr;
}

/** Read the shape outline `<a:ln>` (width + colour + dash) into a
 *  `FrameBorder`; `undefined` when there's no outline or no stroke colour. */
export function readBorder(
  shape: Element,
  theme?: ThemePalette,
  themeLineWidthsEmu?: number[],
): FrameBorder | undefined {
  const spPr = firstChildNS(shape, NS.wps, "spPr") ?? firstChildNS(shape, NS.pic, "spPr");
  const ln = spPr ? firstChildNS(spPr, NS.a, "ln") : null;
  if (ln) {
    // `<a:ln><a:noFill/></a:ln>` is an EXPLICIT no-stroke — it must not
    // fall back to the style lnRef (a gallery shape with its outline
    // removed in Word would grow one back).
    if (firstChildNS(ln, NS.a, "noFill")) return undefined;
    const widthEmu = numAttr(ln, "w");
    const solidFill = firstChildNS(ln, NS.a, "solidFill");
    const color = solidFill ? readDrawingColor(solidFill, theme) : undefined;
    const prstDash = firstChildNS(ln, NS.a, "prstDash");
    if (color) {
      return {
        color,
        widthEmu: widthEmu || 0,
        style: coerceBorderStyle(prstDash?.getAttribute("val")),
      };
    }
    // Direct `<a:ln w>` with no colour child: the WIDTH is direct, the
    // COLOUR comes from the style lnRef (Word merges the two — a page
    // frame with `<a:ln w="12700"/>` + `<a:lnRef><a:schemeClr>` draws a
    // 1pt themed line; returning undefined dropped the frame outline).
    const ref = readStyleRefBorder(shape, theme, themeLineWidthsEmu);
    if (ref) {
      return {
        color: ref.color,
        widthEmu: widthEmu || ref.widthEmu,
        style: coerceBorderStyle(prstDash?.getAttribute("val")),
      };
    }
    return undefined;
  }
  // No DIRECT outline: fall back to the shape-STYLE reference, the way
  // ribbon-inserted gallery shapes record their default thin outline. The
  // `<a:lnRef idx>` picks the WIDTH from the theme's line-style list; the
  // ref's own colour child gives the stroke colour (`idx="0"` = no line).
  return readStyleRefBorder(shape, theme, themeLineWidthsEmu);
}

/** Resolve a shape's outline from `<wps:style><a:lnRef>`: colour from the
 *  ref's child, width from `themeLineWidthsEmu[idx-1]`. */
function readStyleRefBorder(
  shape: Element,
  theme: ThemePalette | undefined,
  themeLineWidthsEmu: number[] | undefined,
): FrameBorder | undefined {
  const style = firstChildNS(shape, NS.wps, "style");
  const lnRef = style ? firstChildNS(style, NS.a, "lnRef") : null;
  if (!lnRef) return undefined;
  const idx = Number.parseInt(lnRef.getAttribute("idx") ?? "0", 10);
  if (!Number.isFinite(idx) || idx <= 0) return undefined;
  const color = readDrawingColor(lnRef, theme);
  if (!color) return undefined;
  return { color, widthEmu: themeLineWidthsEmu?.[idx - 1] ?? 0, style: "solid" };
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
