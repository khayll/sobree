/**
 * Shared structural vocabulary for the DrawingML concept readers. These
 * are the small intermediate shapes the per-concept modules traffic in —
 * deliberately separate from the final Sobree AST (`AnchoredFrame`,
 * `InlineFrame`, `DrawingRun`) so importer and (future) exporter agree on
 * one EMU-coordinate language without coupling to persisted editor types.
 */

/** A DrawingML `<…:ext cx cy>` / `<wp:extent>` size, in EMU. */
export interface EmuExtent {
  cx: number;
  cy: number;
}

/** A DrawingML `<a:off x y>` position, in EMU. */
export interface EmuOffset {
  x: number;
  y: number;
}

/** An `<a:xfrm>` offset+extent pair. Either may be absent in the source. */
export interface XfrmBox {
  off?: EmuOffset;
  ext?: EmuExtent;
}

/** `<wp:positionH relativeFrom>` enum (horizontal frame origin). */
export type RelativeFromH = "page" | "margin" | "column";

/** `<wp:positionV relativeFrom>` enum (vertical frame origin). */
export type RelativeFromV = "page" | "margin" | "paragraph";
