/**
 * Pure functions that mutate `SobreeDocument` to add or remove
 * embedded fonts. The Editor wraps these with `setDocument()` so the
 * change participates in the normal commit + render pipeline.
 *
 * Splitting these out of `Editor` lets tests exercise embed semantics
 * without mounting a real editor, and keeps the Editor class focused
 * on DOM/state plumbing.
 */

import type { SobreeDocument } from "../doc/types";
import { canEmbed, readFsType } from "./fsType";
import { generateFontKey, obfuscate } from "./odttf";
import type { FontDeclaration } from "./types";

export interface EmbedFontFaces {
  regular?: Uint8Array;
  bold?: Uint8Array;
  italic?: Uint8Array;
  boldItalic?: Uint8Array;
}

export interface EmbedFontOptions {
  /** Embed even when OS/2 fsType marks the face as restricted. Default false. */
  allowRestricted?: boolean;
}

export interface EmbedFontResult {
  /** Next document — same reference as input when nothing was embedded. */
  next: SobreeDocument;
  /** Per-face refusal warnings (e.g. restricted licence). */
  warnings: string[];
}

/**
 * Returns the next document with the given font embedded, plus any
 * warnings (e.g. a face refused for licence reasons). When no face
 * could be embedded, `next` is `===` the input doc — caller can
 * skip a setDocument round.
 */
export function embedFontIntoDoc(
  doc: SobreeDocument,
  name: string,
  faces: EmbedFontFaces,
  opts: EmbedFontOptions = {},
): EmbedFontResult {
  const warnings: string[] = [];
  const slots: Array<["regular" | "bold" | "italic" | "boldItalic", Uint8Array | undefined]> = [
    ["regular", faces.regular],
    ["bold", faces.bold],
    ["italic", faces.italic],
    ["boldItalic", faces.boldItalic],
  ];
  const embed: NonNullable<FontDeclaration["embed"]> = {};
  const nextRawParts: Record<string, Uint8Array> = { ...doc.rawParts };

  for (const [key, bytes] of slots) {
    if (!bytes) continue;
    const fsType = readFsType(bytes);
    const verdict = canEmbed(fsType);
    if (verdict.mode === "restricted" && !opts.allowRestricted) {
      warnings.push(
        `Refused to embed "${name}" face "${key}": OS/2 fsType marks it as embedding-restricted.`,
      );
      continue;
    }
    const partPath = allocateFontPath(nextRawParts);
    const fontKey = generateFontKey();
    nextRawParts[partPath] = obfuscate(bytes, fontKey);
    embed[key] = { partPath, fontKey };
  }

  if (Object.keys(embed).length === 0) {
    return { next: doc, warnings };
  }

  // Merge with an existing declaration of the same name (a follow-up
  // embedFont call extends faces rather than duplicating).
  const existingIdx = doc.fonts.findIndex((f) => f.name === name);
  const nextFonts: FontDeclaration[] = doc.fonts.slice();
  if (existingIdx >= 0) {
    const existing = nextFonts[existingIdx]!;
    nextFonts[existingIdx] = {
      ...existing,
      embed: { ...existing.embed, ...embed },
    };
  } else {
    nextFonts.push({ name, embed });
  }
  return {
    next: { ...doc, rawParts: nextRawParts, fonts: nextFonts },
    warnings,
  };
}

/**
 * Drop a font declaration by name. Returns the same doc reference if
 * the name wasn't present (caller can skip a setDocument round).
 *
 * Font part bytes are NOT removed from `rawParts` — call
 * `pruneOrphanParts(doc)` (or just rely on export-side filtering) to
 * GC them.
 */
export function removeFontFromDoc(
  doc: SobreeDocument,
  name: string,
): SobreeDocument {
  const next = doc.fonts.filter((f) => f.name !== name);
  if (next.length === doc.fonts.length) return doc;
  return { ...doc, fonts: next };
}

/** Next free `word/fonts/fontN.odttf` slot. */
function allocateFontPath(rawParts: Record<string, Uint8Array>): string {
  let n = 1;
  while (rawParts[`word/fonts/font${n}.odttf`]) n += 1;
  return `word/fonts/font${n}.odttf`;
}
