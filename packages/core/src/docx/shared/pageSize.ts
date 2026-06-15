import type { Orientation, PageSizeKey, PageSizeMM } from "../../paperStack/pageSetup";
import { PAGE_SIZES } from "../../paperStack/pageSetup";
import { mmToTwips, twipsToMm } from "./units";

export interface PageGeometry {
  size: PageSizeKey;
  orientation: Orientation;
  margins: { top: number; right: number; bottom: number; left: number };
}

/**
 * Resolve twips W×H back to a named page size at a given orientation. If it
 * doesn't match a known size within a small tolerance, return the nearest
 * one — users editing a custom-sized doc in Sobree still get a sensible
 * landing spot, and the exact dimensions come back on export because we
 * write our own sectPr anyway.
 */
export function matchPageSize(
  widthTwips: number,
  heightTwips: number,
): {
  size: PageSizeKey;
  orientation: Orientation;
} {
  const widthMm = twipsToMm(widthTwips);
  const heightMm = twipsToMm(heightTwips);
  const portrait = heightMm >= widthMm;
  const [w, h] = portrait ? [widthMm, heightMm] : [heightMm, widthMm];

  let best: PageSizeKey = "A4";
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [key, mm] of Object.entries(PAGE_SIZES) as [PageSizeKey, PageSizeMM][]) {
    const d = Math.abs(mm.width - w) + Math.abs(mm.height - h);
    if (d < bestDist) {
      bestDist = d;
      best = key;
    }
  }
  return { size: best, orientation: portrait ? "portrait" : "landscape" };
}

/** Convert a PageSetup's logical size+orientation to the twip W/H pair. */
export function geometryToTwips(geom: PageGeometry): { w: number; h: number } {
  const mm = PAGE_SIZES[geom.size];
  const [widthMm, heightMm] =
    geom.orientation === "portrait" ? [mm.width, mm.height] : [mm.height, mm.width];
  return { w: mmToTwips(widthMm), h: mmToTwips(heightMm) };
}
