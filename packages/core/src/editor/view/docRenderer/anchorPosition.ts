/**
 * Resolve an anchored frame's ABSOLUTE position (card-relative, EMU) from
 * its `AnchorOrigin.relativeFrom` enums + the page geometry.
 *
 * OOXML positions a floating object as `origin(relativeFrom) + posOffset`,
 * where the origin is the page edge, the page margin, or the anchor
 * paragraph. The renderer paints frames into a full-card overlay
 * (`inset: 0`), so each frame needs its origin resolved to an absolute
 * card coordinate rather than baked into the overlay's CSS inset (which
 * could only ever encode ONE origin).
 *
 * Pure + DOM-free: the caller (the Paper DOM adapter) measures the page
 * margins and the anchor paragraph's rendered top, passes them in as EMU.
 * Kept here so the relativeFrom semantics are unit-testable without a
 * layout engine.
 */

import type { AnchoredFrame } from "../../../doc/types";

export interface AnchorGeometry {
  /** Page top margin (`<w:pgMar w:top>`) in EMU, card-relative. */
  marginTopEmu: number;
  /** Page left margin (`<w:pgMar w:left>`) in EMU, card-relative. */
  marginLeftEmu: number;
  /**
   * Rendered top of the anchor paragraph, card-relative, in EMU.
   * Required when `verticalFrom === "paragraph"`; when absent (the
   * paragraph couldn't be located) the frame falls back to margin-top —
   * a paragraph-anchored frame is never page-relative.
   */
  anchorParaTopEmu?: number | null;
}

export function resolveAnchorPosition(
  frame: AnchoredFrame,
  geom: AnchorGeometry,
): { xEmu: number; yEmu: number } {
  return {
    xEmu: horizontalBaseEmu(frame, geom) + frame.offsetXEmu,
    yEmu: verticalBaseEmu(frame, geom) + frame.offsetYEmu,
  };
}

function verticalBaseEmu(frame: AnchoredFrame, geom: AnchorGeometry): number {
  switch (frame.anchor.verticalFrom) {
    case "page":
      return 0;
    case "margin":
      return geom.marginTopEmu;
    case "paragraph":
      return geom.anchorParaTopEmu ?? geom.marginTopEmu;
  }
}

function horizontalBaseEmu(frame: AnchoredFrame, geom: AnchorGeometry): number {
  switch (frame.anchor.horizontalFrom) {
    case "page":
      return 0;
    // `column` is the text column's left edge; for a single-column section
    // that's the left page margin. Multi-column column offsets are a
    // follow-up — they'd need the column's own left.
    case "margin":
    case "column":
      return geom.marginLeftEmu;
  }
}
