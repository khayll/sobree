/**
 * Owns DrawingML text-distance insets: the `distT/B/L/R` attributes on
 * `<wp:anchor>` — the clearance Word keeps between a wrapped frame and the
 * text flowing around it. Maps to `AnchoredFrame.textDistancesEmu` /
 * (after the float pass) `DrawingRun.floatMarginsEmu`.
 */

import { emuAttr } from "./extents";

/** Text-distance insets in EMU, all four sides. */
export interface TextDistancesEmu {
  topEmu: number;
  rightEmu: number;
  bottomEmu: number;
  leftEmu: number;
}

/**
 * `distT/B/L/R` are attributes of `<wp:anchor>` itself (not the wrap
 * child). Returns `undefined` when ALL four are absent — a frame with no
 * declared clearance models none; a partially-declared one zero-fills the
 * omitted sides (Word's default distance is 0 for the wrap modes).
 */
export function readTextDistances(anchor: Element): TextDistancesEmu | undefined {
  const t = anchor.getAttribute("distT");
  const b = anchor.getAttribute("distB");
  const l = anchor.getAttribute("distL");
  const r = anchor.getAttribute("distR");
  if (t === null && b === null && l === null && r === null) return undefined;
  return {
    topEmu: emuAttr(t),
    bottomEmu: emuAttr(b),
    leftEmu: emuAttr(l),
    rightEmu: emuAttr(r),
  };
}
