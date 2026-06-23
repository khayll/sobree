/**
 * Editor-side mutation helpers.
 *
 * The pure document mutation helpers (`Mutation`, the `merge*` functions,
 * the section-break merge math) now live in the shared engine at
 * `doc/mutations` so the browser `Editor` and `HeadlessSobree` use one
 * implementation. They're re-exported here so existing
 * `editor/internal/mutations` imports keep resolving.
 *
 * What stays here is editor-/parts-oriented and not part of the document
 * mutation engine: the toolbar wrap-tag mapping and the media-part helpers
 * used by image embedding.
 */

import type { RunPropertiesPatch } from "../../doc/runs";
import type { SobreeDocument } from "../../doc/types";
import type { WrapTag } from "../types";

export type { Mutation } from "../../doc/mutations";
export {
  mergeNamedStyle,
  mergeParagraphProps,
  mergeSectionProps,
  mergeSectionsAcross,
  removedSectionIndex,
} from "../../doc/mutations";

/**
 * Map a semantic "wrap" tag to the run-property patch that achieves it.
 * Same mapping the browser editor uses for toolbar buttons.
 */
export function wrapTagToPatch(tag: WrapTag): RunPropertiesPatch {
  switch (tag) {
    case "strong":
      return { bold: true };
    case "em":
      return { italic: true };
    case "u":
      return { underline: "single" };
    case "s":
      return { strike: true };
    case "sup":
      return { verticalAlign: "superscript" };
    case "sub":
      return { verticalAlign: "subscript" };
    case "mark":
      return { highlight: "yellow" };
  }
}

/** Map an image MIME type to a `.docx` part filename extension. */
export function mimeToExtension(mime: string): string {
  const m = mime.toLowerCase();
  if (m === "image/png") return "png";
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/gif") return "gif";
  if (m === "image/webp") return "webp";
  if (m === "image/svg+xml") return "svg";
  if (m === "image/bmp") return "bmp";
  return "bin";
}

/** Find the next free `word/media/imageN.<ext>` slot in `rawParts`. */
export function allocateMediaPath(doc: SobreeDocument, ext: string): string {
  let n = 1;
  while (doc.rawParts[`word/media/image${n}.${ext}`]) n += 1;
  return `word/media/image${n}.${ext}`;
}

/** Convert pixels (CSS @ 96 dpi) to OOXML's EMU (914400 per inch). */
export function pxToEmu(px: number): number {
  return Math.round((px / 96) * 914400);
}
