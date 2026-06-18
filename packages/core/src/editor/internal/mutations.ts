/**
 * Pure helpers shared between `Editor` (DOM-backed) and `HeadlessSobree`
 * (no-DOM peer for LLMs / agents / automation).
 *
 * These functions don't touch DOM, don't carry state, and don't depend
 * on Y.js — they operate on `SobreeDocument` shapes. Both editors share
 * the same logic for block-level mutations so a headless peer's edits
 * land in the Y.Doc with identical semantics to a browser peer's.
 */

import type { RunPropertiesPatch } from "../../doc/runs";
import type {
  Block,
  ParagraphProperties,
  RunProperties,
  SectionProperties,
  SobreeDocument,
} from "../../doc/types";
import type { ParagraphPropertiesPatch, SectionPropertiesPatch, WrapTag } from "../types";

/**
 * One registry-level operation produced by a mutation. The caller
 * applies these to the BlockRegistry after committing the new doc:
 * `insert` adds an id, `remove` drops one, `bump` keeps the same id
 * but increments its version.
 */
export type Mutation =
  | { type: "bump"; index: number }
  | { type: "insert"; index: number }
  | { type: "remove"; index: number };

/**
 * Index in `sections` of the section that ENDS at the section_break at
 * `breakIndex`. Sections are 1:1 with section_breaks; the first
 * section ends at the first break (or at the end of `body` if there's
 * no break).
 *
 *   body = [p, p, break, p, break, p]
 *   sections = [s0, s1, s2]
 *
 *   breakIndex = 2 → 0 (the first break ends section 0)
 *   breakIndex = 4 → 1 (the second break ends section 1)
 */
export function removedSectionIndex(body: readonly Block[], breakIndex: number): number {
  let count = 0;
  for (let i = 0; i < breakIndex; i++) {
    if (body[i]?.kind === "section_break") count++;
  }
  return count;
}

/**
 * Drop the section at `endingIndex + 1` from `sections` — that's the
 * section the now-removed break STARTED. The section ENDED by the
 * removed break (at `endingIndex`) absorbs whatever content used to
 * belong to its successor. Properties of the surviving section are
 * preserved verbatim; nothing about the removed section's settings is
 * carried over.
 *
 * If `sections` doesn't have a successor (the removed break was the
 * last one and there's only one section), the array is returned
 * unchanged.
 */
export function mergeSectionsAcross(
  sections: readonly SectionProperties[],
  endingIndex: number,
): SectionProperties[] {
  const next = sections.slice();
  if (endingIndex + 1 >= next.length) return next;
  next.splice(endingIndex + 1, 1);
  return next;
}

/**
 * Merge a `ParagraphPropertiesPatch` into existing properties.
 * `undefined` in the patch removes a field; everything else
 * overwrites.
 */
export function mergeParagraphProps(
  prev: ParagraphProperties,
  patch: ParagraphPropertiesPatch,
): ParagraphProperties {
  const out: ParagraphProperties = { ...prev };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete (out as Record<string, unknown>)[k];
    else (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * Merge a {@link SectionPropertiesPatch} onto existing section properties.
 * `pageSize` / `pageMargins` are FIELD-merged (a partial stays valid); the
 * other fields replace wholesale. For the optional fields (`columns`,
 * `titlePage`, `type`, `vAlign`) an explicit `undefined` clears them, while
 * the required `headerRefs` / `footerRefs` only replace when present.
 */
export function mergeSectionProps(
  prev: SectionProperties,
  patch: SectionPropertiesPatch,
): SectionProperties {
  const out: SectionProperties = { ...prev };
  if (patch.pageSize) out.pageSize = { ...out.pageSize, ...patch.pageSize };
  if (patch.pageMargins) out.pageMargins = { ...out.pageMargins, ...patch.pageMargins };
  if (patch.headerRefs !== undefined) out.headerRefs = patch.headerRefs;
  if (patch.footerRefs !== undefined) out.footerRefs = patch.footerRefs;
  assignOptional(out, "columns", patch, "columns");
  assignOptional(out, "titlePage", patch, "titlePage");
  assignOptional(out, "type", patch, "type");
  assignOptional(out, "vAlign", patch, "vAlign");
  return out;
}

/** Apply an optional field from `patch` onto `out` when the key is present:
 *  `undefined` deletes it, any other value sets it. Absent ⇒ untouched. */
function assignOptional<T extends object, P extends object>(
  out: T,
  outKey: keyof T,
  patch: P,
  patchKey: keyof P,
): void {
  if (!(patchKey in patch)) return;
  const value = patch[patchKey];
  if (value === undefined) delete out[outKey];
  else (out as Record<string, unknown>)[outKey as string] = value;
}

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

// Suppress unused warnings — these types are referenced for JSDoc / future use.
export type { RunProperties };
