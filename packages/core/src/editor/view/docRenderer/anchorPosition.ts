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
  /**
   * Full page size in EMU. Required to resolve `align` / `pctPos*`
   * positioning forms (they place the frame within the BASE EXTENT —
   * the page box or the margin/content box — so the resolver needs the
   * box's size, not just its origin). When absent, align/pct frames
   * degrade to the base origin (offset-0 behaviour).
   */
  pageWidthEmu?: number;
  pageHeightEmu?: number;
  /** Right / bottom page margins in EMU — with the left/top margins
   *  these bound the margin (content) box for align / pct resolution. */
  marginRightEmu?: number;
  marginBottomEmu?: number;
}

/**
 * Resolve a frame's RENDERED size. `<wp14:pctWidth>`/`<wp14:pctHeight>`
 * size the shape as a fraction of the page or margin box; the stored
 * `widthEmu`/`heightEmu` (from `<wp:extent>`) is only Word's
 * last-computed value and goes stale when the layout context changes —
 * a CV's footer page-frame declares 108.5% of the margin box beside an
 * extent computed under different margins, and honouring the extent
 * drew the frame ring 0.27in too far in on every side. Falls back to
 * the extent when the geometry can't supply the base box.
 */
export function resolveAnchorSize(
  frame: AnchoredFrame,
  geom: AnchorGeometry,
): { widthEmu: number; heightEmu: number } {
  let widthEmu = frame.widthEmu;
  let heightEmu = frame.heightEmu;
  if (frame.pctWidth !== undefined && geom.pageWidthEmu !== undefined) {
    const base =
      frame.pctWidthFrom === "page"
        ? geom.pageWidthEmu
        : geom.marginRightEmu !== undefined
          ? geom.pageWidthEmu - geom.marginLeftEmu - geom.marginRightEmu
          : undefined;
    if (base !== undefined) widthEmu = frame.pctWidth * base;
  }
  if (frame.pctHeight !== undefined && geom.pageHeightEmu !== undefined) {
    const base =
      frame.pctHeightFrom === "page"
        ? geom.pageHeightEmu
        : geom.marginBottomEmu !== undefined
          ? geom.pageHeightEmu - geom.marginTopEmu - geom.marginBottomEmu
          : undefined;
    if (base !== undefined) heightEmu = frame.pctHeight * base;
  }
  return { widthEmu, heightEmu };
}

export function resolveAnchorPosition(
  frame: AnchoredFrame,
  geom: AnchorGeometry,
): { xEmu: number; yEmu: number } {
  return {
    xEmu: horizontalBaseEmu(frame, geom) + horizontalWithinBaseEmu(frame, geom),
    yEmu: verticalBaseEmu(frame, geom) + verticalWithinBaseEmu(frame, geom),
  };
}

/**
 * The frame's position WITHIN its base extent — one of Word's three
 * per-axis forms: an EMU offset (`<wp:posOffset>`, the stored default),
 * an alignment keyword (`<wp:align>` — centred page frames), or a
 * percent of the base extent (`<wp14:pctPos*Offset>` — a footer bar at
 * 100% of the margin box sits at the bottom margin line). Exactly one
 * is set per axis; align/pct need the base extent from the geometry and
 * fall back to the plain offset when the caller can't supply it.
 */
function horizontalWithinBaseEmu(frame: AnchoredFrame, geom: AnchorGeometry): number {
  const extent = horizontalExtentEmu(frame, geom);
  if (extent !== undefined) {
    if (frame.alignH !== undefined) {
      if (frame.alignH === "center") return (extent - frame.widthEmu) / 2;
      if (frame.alignH === "right") return extent - frame.widthEmu;
      return 0;
    }
    if (frame.pctPosX !== undefined) return frame.pctPosX * extent;
  }
  return frame.offsetXEmu;
}

function verticalWithinBaseEmu(frame: AnchoredFrame, geom: AnchorGeometry): number {
  const extent = verticalExtentEmu(frame, geom);
  if (extent !== undefined) {
    if (frame.alignV !== undefined) {
      if (frame.alignV === "center") return (extent - frame.heightEmu) / 2;
      if (frame.alignV === "bottom") return extent - frame.heightEmu;
      return 0;
    }
    if (frame.pctPosY !== undefined) return frame.pctPosY * extent;
  }
  return frame.offsetYEmu;
}

function horizontalExtentEmu(frame: AnchoredFrame, geom: AnchorGeometry): number | undefined {
  if (geom.pageWidthEmu === undefined) return undefined;
  if (frame.anchor.horizontalFrom === "page") return geom.pageWidthEmu;
  if (geom.marginRightEmu === undefined) return undefined;
  return geom.pageWidthEmu - geom.marginLeftEmu - geom.marginRightEmu;
}

function verticalExtentEmu(frame: AnchoredFrame, geom: AnchorGeometry): number | undefined {
  if (geom.pageHeightEmu === undefined) return undefined;
  if (frame.anchor.verticalFrom === "page") return geom.pageHeightEmu;
  if (geom.marginBottomEmu === undefined) return undefined;
  // Margin and paragraph bases share the content-box height; a
  // paragraph-based align/pct is vanishingly rare and Word treats the
  // extent as the content box there too.
  return geom.pageHeightEmu - geom.marginTopEmu - geom.marginBottomEmu;
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
