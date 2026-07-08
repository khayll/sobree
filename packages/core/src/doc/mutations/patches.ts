/**
 * Document patch vocabulary — the partial-update shapes the pure mutation
 * engine consumes and both adapters (`Editor` / `HeadlessSobree`) accept.
 *
 * These live in the document layer, next to the mutation functions that
 * interpret them (`mergeParagraphProps`, `mergeSectionProps`,
 * `mergeNamedStyle`), because the merge semantics ARE the type's meaning —
 * a patch is only well-defined against the document field it merges onto.
 * The editor re-exports them (`editor/types.ts`) so the public surface is
 * unchanged; the engine no longer reaches up into `editor/` for its own
 * vocabulary. Sibling to {@link RunPropertiesPatch} in `doc/runs.ts`.
 */

import type {
  HeaderFooterRef,
  NamedStyle,
  PageMargins,
  PageSize,
  ParagraphProperties,
  SectionColumns,
  SectionProperties,
} from "../types";

/**
 * Patch for a paragraph's properties. Each present field overwrites; an
 * explicit `undefined` clears that field. See `mergeParagraphProps`.
 */
export type ParagraphPropertiesPatch = {
  [K in keyof ParagraphProperties]?: ParagraphProperties[K] | undefined;
};

/**
 * Patch for a section's properties (page geometry, columns, header/footer
 * refs, vertical alignment). `pageSize` / `pageMargins` are FIELD-merged
 * into the existing values (so a partial — e.g. just `orientation` or
 * `topTwips` — stays valid); every other field REPLACES wholesale, and an
 * explicit `undefined` on an optional field clears it.
 */
export interface SectionPropertiesPatch {
  pageSize?: Partial<PageSize>;
  pageMargins?: Partial<PageMargins>;
  columns?: SectionColumns | undefined;
  headerRefs?: HeaderFooterRef[];
  footerRefs?: HeaderFooterRef[];
  titlePage?: boolean | undefined;
  type?: SectionProperties["type"];
  vAlign?: SectionProperties["vAlign"];
}

/**
 * Patch for an existing named style (everything except its `id`). Each
 * present field replaces the style's corresponding field wholesale; an
 * explicit `undefined` clears an optional one. The required `type` /
 * `displayName` are never cleared.
 */
export type NamedStylePatch = {
  [K in keyof Omit<NamedStyle, "id">]?: NamedStyle[K] | undefined;
};
