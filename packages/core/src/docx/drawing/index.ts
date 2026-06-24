/**
 * DrawingML concept modules — the single home for OOXML `<w:drawing>`
 * translation, split by concept (extents, position, wrap, margins,
 * relationships, colours, shape properties). The import dispatch
 * (`docx/import/{anchored,inline,float,flow}Frames`) and serialization
 * (`docx/export/drawings`) call into these; they do not re-implement EMU
 * math or `relativeFrom` coercion. See `OWNERSHIP.md`.
 */

export {
  directChildrenNS,
  findAncestor,
  firstChildNS,
  firstNS,
} from "./dom";
export { emuAttr, numAttr, numAttrOr, readExtent } from "./extents";
export { coerceHRelativeFrom, coerceVRelativeFrom, readPosOffset } from "./position";
export { readWrapText, readWrapType } from "./wrap";
export type { WrapText, WrapType } from "./wrap";
export { readTextDistances } from "./margins";
export type { TextDistancesEmu } from "./margins";
export { normalizePartPath, readBlipEmbedPart } from "./relationships";
export { readBorder, readGeometry, readSolidFill } from "./shapeProps";
export { parseThemeXml, readDrawingColor } from "./colors";
export type { ThemePalette } from "./colors";
export type {
  EmuExtent,
  EmuOffset,
  RelativeFromH,
  RelativeFromV,
  XfrmBox,
} from "./model";
