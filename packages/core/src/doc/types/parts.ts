// Binary parts, font declarations, and the relationship manifest.
//
// `FontDeclaration` + `FontEmbedRef` live in `../../fonts/types` so the
// fonts module owns its own AST shapes. Re-exported here so existing
// consumers keep importing `FontDeclaration` from `doc/types`.
export type { FontDeclaration, FontEmbedRef } from "../../fonts/types";

// === relationships ===

/**
 * Mirror of the `_rels/document.xml.rels` table — Sobree tracks
 * relationships as data so headers, footers, images, hyperlinks all share
 * one allocation strategy at export time.
 */
export interface RelationshipManifest {
  /** Map of `rId…` → relationship descriptor. */
  byId: Record<string, Relationship>;
}

export interface Relationship {
  id: string;
  type: RelationshipType;
  target: string;
  /** External (true) means `target` is a URL; otherwise a part path. */
  external?: boolean;
}

export type RelationshipType =
  | "header"
  | "footer"
  | "image"
  | "hyperlink"
  | "styles"
  | "numbering"
  | "settings"
  | "fontTable"
  | "theme"
  | "comments"
  | "footnotes"
  | "endnotes";
