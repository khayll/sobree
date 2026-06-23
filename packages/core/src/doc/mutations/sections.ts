// Section mutations: section-break merge helpers and section-property edits.

import { fail } from "../api";
import type { Block, SectionProperties } from "../types";
import type { SectionPropertiesPatch } from "../../editor/types";
import { type DocumentMutationResult, type MutationInput, okPatch } from "./types";

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

/** Merge a patch into the section at `sectionIndex`. No block versions
 *  bump — a section is not a block. Fails if the index is out of range. */
export function applySectionPropertiesMutation(
  input: MutationInput,
  sectionIndex: number,
  patch: SectionPropertiesPatch,
): DocumentMutationResult<void> {
  const section = input.doc.sections[sectionIndex];
  if (!Number.isInteger(sectionIndex) || section === undefined) {
    return fail({
      code: "invalid-state",
      details: `no section at index ${sectionIndex} (document has ${input.doc.sections.length})`,
    });
  }
  const next = input.doc.sections.slice();
  next[sectionIndex] = mergeSectionProps(section, patch);
  return okPatch({ sections: next }, []);
}
