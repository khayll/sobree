import type * as Y from "yjs";
import type {
  AnchoredFrame,
  Block,
  Comment,
  FontDeclaration,
  NamedStyle,
  NumberingDefinition,
  SectionProperties,
  SobreeDocument,
} from "../doc/types";
import { projectBlock } from "./blockCodec";
import {
  Y_BLOCK_ID_KEY,
  Y_BODY_KEY,
  Y_META_FIELDS,
  Y_META_KEY,
  Y_PARTREFS_KEY,
  Y_PARTS_KEY,
} from "./schema";

/**
 * Read the SobreeDocument projection out of a Y.Doc.
 *
 * Returns:
 *
 *   - **`doc`** — the projected SobreeDocument. Its `rawParts` is
 *     populated from the Y.Doc's inline `parts` Y.Map only.
 *   - **`ids`** — block-id order matching `doc.body`. The Editor
 *     uses this to keep its BlockRegistry in sync.
 *   - **`partRefs`** — partPath → hash mappings from the Y.Doc's
 *     `partRefs` Y.Map (Phase 3.2+). Empty `{}` when no BlobStore-
 *     using peer has touched the doc. **The caller (Editor /
 *     HeadlessSobree) is responsible for resolving these through a
 *     `BlobCache`** and merging the results into `doc.rawParts`.
 *     We keep the resolution decoupled so projection has no async
 *     work or external dependency.
 *
 * Two block shapes are supported:
 *
 *   - Phase 1b.5+: paragraphs as `{ kind: "paragraph", text: Y.Text, props }`.
 *   - Phase 1a:    everything else as `{ _ast: JSON }`.
 *
 * Backwards compat: a Phase 1a-shaped paragraph (only `_ast`, no `kind`
 * field) projects identically — the JSON is parsed straight to
 * `Paragraph`.
 *
 * This is allocation-heavy; the Editor caches the result and invalidates
 * on Y.Doc updates.
 */
export function projectYDoc(ydoc: Y.Doc): {
  doc: SobreeDocument;
  ids: string[];
  partRefs: Record<string, string>;
} {
  const body = ydoc.getArray<Y.Map<unknown>>(Y_BODY_KEY);
  const meta = ydoc.getMap<string>(Y_META_KEY);
  const parts = ydoc.getMap<Uint8Array>(Y_PARTS_KEY);
  const partRefsMap = ydoc.getMap<string>(Y_PARTREFS_KEY);

  const blocks: Block[] = [];
  const ids: string[] = [];
  // biome-ignore lint/complexity/noForEach: Yjs Y.Array.forEach, not Array.prototype — Y.Array isn't a for-of iterable.
  body.forEach((m) => {
    const id = (m.get(Y_BLOCK_ID_KEY) as string | undefined) ?? "";
    const block = projectBlock(m);
    if (!block) return;
    blocks.push(block);
    ids.push(id);
  });

  const sections = parseMeta<SectionProperties[]>(meta, Y_META_FIELDS.sections, []);
  const headerFooterBodies = parseMeta<Record<string, Block[]>>(
    meta,
    Y_META_FIELDS.headerFooterBodies,
    {},
  );
  const anchoredFrames = parseMeta<AnchoredFrame[]>(meta, Y_META_FIELDS.anchoredFrames, []);
  const headerFooterFrames = parseMeta<Record<string, AnchoredFrame[]>>(
    meta,
    Y_META_FIELDS.headerFooterFrames,
    {},
  );
  const footnotes = parseMeta<Record<number, Block[]>>(meta, Y_META_FIELDS.footnotes, {});
  const comments = parseMeta<Record<number, Comment>>(meta, Y_META_FIELDS.comments, {});
  const settings = parseMeta<{ defaultTabStopTwips?: number }>(meta, Y_META_FIELDS.settings, {});
  const styles = parseMeta<NamedStyle[]>(meta, Y_META_FIELDS.styles, []);
  const numbering = parseMeta<NumberingDefinition[]>(meta, Y_META_FIELDS.numbering, []);
  const fonts = parseMeta<FontDeclaration[]>(meta, Y_META_FIELDS.fonts, []);

  const rawParts: Record<string, Uint8Array> = {};
  parts.forEach((bytes, path) => {
    rawParts[path] = bytes;
  });

  const partRefs: Record<string, string> = {};
  partRefsMap.forEach((hash, path) => {
    partRefs[path] = hash;
  });

  return {
    doc: {
      body: blocks,
      sections,
      headerFooterBodies,
      // Optional fields stay absent when empty so the projected doc keeps
      // the same shape the importer produces (exactOptionalPropertyTypes).
      ...(anchoredFrames.length > 0 ? { anchoredFrames } : {}),
      ...(Object.keys(headerFooterFrames).length > 0 ? { headerFooterFrames } : {}),
      ...(Object.keys(footnotes).length > 0 ? { footnotes } : {}),
      ...(Object.keys(comments).length > 0 ? { comments } : {}),
      ...(settings.defaultTabStopTwips !== undefined ? { settings } : {}),
      styles,
      numbering,
      rawParts,
      fonts,
    },
    ids,
    partRefs,
  };
}

function parseMeta<T>(meta: Y.Map<string>, key: string, fallback: T): T {
  const s = meta.get(key);
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
