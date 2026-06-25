/**
 * Expand DrawingML PRESET geometries that a CSS box can't draw — arrows,
 * callouts, and the like — into an SVG outline. Box-expressible presets
 * (rect / ellipse / roundedRect / line) stay as geometry enums via
 * `readGeometry`; this module only handles presets that genuinely need a
 * path, and returns `null` for everything else so that fallback stands.
 *
 * The outline is emitted in the frame's OWN `widthEmu × heightEmu` box so
 * the renderer's `preserveAspectRatio="none"` scale is 1:1 — a normalised
 * square box would shear the arrowhead when the frame isn't square.
 *
 * Adjustment handles (`<a:avLst><a:gd name="adjN" fmla="val …"/>`) tune
 * the shaft thickness and head length; absent ⇒ ECMA-376 factory
 * defaults. Reading them keeps the shape faithful to the source instead
 * of guessing proportions.
 */

import { NS } from "../shared/namespaces";
import { firstChildNS } from "./dom";

export interface PresetPath {
  widthEmu: number;
  heightEmu: number;
  d: string;
}

/** Expand the shape's `<a:prstGeom>` into a path, or `null` when the
 *  preset is box-expressible / unmodelled (caller keeps `readGeometry`). */
export function expandPresetGeometry(
  wsp: Element,
  dims: { widthEmu: number; heightEmu: number },
): PresetPath | null {
  const spPr = firstChildNS(wsp, NS.wps, "spPr") ?? firstChildNS(wsp, NS.pic, "spPr");
  if (!spPr) return null;
  const prstGeom = firstChildNS(spPr, NS.a, "prstGeom");
  switch (prstGeom?.getAttribute("prst")) {
    case "rightArrow":
      return rightArrowPath(dims, readAdjustments(prstGeom));
    default:
      return null;
  }
}

/**
 * Block right-arrow (ECMA-376 preset `rightArrow`): a centred shaft
 * leading into a triangular head. `adj1` is the shaft thickness as a
 * fraction of height; `adj2` the head length as a fraction of the
 * smaller side. Both default to 50%.
 */
function rightArrowPath(
  dims: { widthEmu: number; heightEmu: number },
  adj: Map<string, number>,
): PresetPath {
  const w = dims.widthEmu;
  const h = dims.heightEmu;
  const ss = Math.min(w, h);
  const vc = h / 2;
  const a1 = clamp(adj.get("adj1") ?? 50000, 0, 100000);
  const maxAdj2 = ss > 0 ? (100000 * w) / ss : 0;
  const a2 = clamp(adj.get("adj2") ?? 50000, 0, maxAdj2);
  const dy = (h * a1) / 200000; // shaft half-height
  const y1 = vc - dy;
  const y2 = vc + dy;
  const x2 = w - (ss * a2) / 100000; // where the head begins
  const d = [
    `M0 ${r(y1)}`,
    `L${r(x2)} ${r(y1)}`,
    `L${r(x2)} 0`,
    `L${r(w)} ${r(vc)}`,
    `L${r(x2)} ${r(h)}`,
    `L${r(x2)} ${r(y2)}`,
    `L0 ${r(y2)}`,
    "Z",
  ].join(" ");
  return { widthEmu: w, heightEmu: h, d };
}

/** `<a:avLst><a:gd name fmla="val N"/>` → `name → N`. Non-`val` formulas
 *  (the geometry guides Word computes itself) are ignored. */
function readAdjustments(prstGeom: Element): Map<string, number> {
  const out = new Map<string, number>();
  const avLst = firstChildNS(prstGeom, NS.a, "avLst");
  if (!avLst) return out;
  for (const gd of Array.from(avLst.children)) {
    if (gd.namespaceURI !== NS.a || gd.localName !== "gd") continue;
    const name = gd.getAttribute("name");
    const m = gd.getAttribute("fmla")?.match(/^val\s+(-?\d+)$/);
    if (name && m) out.set(name, Number(m[1]));
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Round to whole EMU — the viewBox unit. Keeps `d` strings compact
 *  without visible precision loss (1 EMU = 1/914400 inch). */
function r(v: number): number {
  return Math.round(v);
}
