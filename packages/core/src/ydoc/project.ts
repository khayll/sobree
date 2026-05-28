import type * as Y from "yjs";
import * as YModule from "yjs";
import type {
  Block,
  FontDeclaration,
  NamedStyle,
  NumberingDefinition,
  Paragraph,
  ParagraphProperties,
  SectionProperties,
  SobreeDocument,
} from "../doc/types";
import { type DeltaOp, deltaToRuns } from "./runs";
import {
  Y_BLOCK_AST_KEY,
  Y_BLOCK_ID_KEY,
  Y_BLOCK_KIND_KEY,
  Y_BLOCK_PROPS_KEY,
  Y_BLOCK_TEXT_KEY,
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
      styles,
      numbering,
      rawParts,
      fonts,
    },
    ids,
    partRefs,
  };
}

/**
 * Read a single block Y.Map into a Block. Returns `null` if the map
 * is empty / unrecognizable (defensive — projectYDoc skips nulls).
 */
export function projectBlock(map: Y.Map<unknown>): Block | null {
  // Phase 1b.5+: paragraph blocks have `kind === "paragraph"` and a
  // Y.Text under `text`.
  const kind = map.get(Y_BLOCK_KIND_KEY) as string | undefined;
  if (kind === "paragraph") {
    return projectParagraph(map);
  }
  // Phase 1a fallback: JSON-encoded block under `_ast`.
  const ast = map.get(Y_BLOCK_AST_KEY) as string | undefined;
  if (ast) {
    try {
      return JSON.parse(ast) as Block;
    } catch {
      return null;
    }
  }
  return null;
}

function projectParagraph(map: Y.Map<unknown>): Paragraph | null {
  const textObj = map.get(Y_BLOCK_TEXT_KEY);
  if (!(textObj instanceof YModule.Text)) return null;
  const propsStr = map.get(Y_BLOCK_PROPS_KEY) as string | undefined;
  let properties: ParagraphProperties = {};
  if (propsStr) {
    try {
      properties = JSON.parse(propsStr) as ParagraphProperties;
    } catch {
      properties = {};
    }
  }
  const delta = textObj.toDelta() as DeltaOp[];
  const runs = deltaToRuns(delta);
  return { kind: "paragraph", properties, runs };
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
