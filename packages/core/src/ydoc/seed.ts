import * as Y from "yjs";
import type { Block, Paragraph, SobreeDocument } from "../doc/types";
import { runsToDelta } from "./runs";
import {
  Y_BLOCK_AST_KEY,
  Y_BLOCK_ID_KEY,
  Y_BLOCK_KIND_KEY,
  Y_BLOCK_PROPS_KEY,
  Y_BLOCK_TEXT_KEY,
  Y_BODY_KEY,
  Y_META_FIELDS,
  Y_META_KEY,
  Y_PARTS_KEY,
} from "./schema";

/**
 * Populate a fresh (or reset) Y.Doc with the contents of a SobreeDocument.
 *
 * Caller supplies the parallel `ids` array — these become the stable
 * block ids stored in each block's Y.Map. The Editor's BlockRegistry
 * generates them.
 *
 * Wraps the seed in `Y.Doc.transact` with `origin = "seed"` so a
 * UndoManager scoped to the local origin won't push the seed onto its
 * stack.
 */
export function seedYDoc(ydoc: Y.Doc, doc: SobreeDocument, ids: readonly string[]): void {
  if (ids.length !== doc.body.length) {
    throw new Error(
      `seedYDoc: ids length (${ids.length}) !== body length (${doc.body.length})`,
    );
  }
  const body = ydoc.getArray<Y.Map<unknown>>(Y_BODY_KEY);
  const meta = ydoc.getMap<string>(Y_META_KEY);
  const parts = ydoc.getMap<Uint8Array>(Y_PARTS_KEY);

  ydoc.transact(() => {
    // Reset
    if (body.length > 0) body.delete(0, body.length);
    for (const k of [...meta.keys()]) meta.delete(k);
    for (const k of [...parts.keys()]) parts.delete(k);

    // Body — two-phase to keep Yjs happy:
    //   Phase 1: build skeleton Y.Maps (id + kind + empty Y.Text for
    //            paragraphs), insert them all into body. Yjs integrates
    //            each map and its child Y.Text on insert.
    //   Phase 2: populate content (applyDelta to the now-integrated
    //            Y.Texts; JSON for everything else).
    //
    // Doing applyDelta on an unintegrated Y.Text *works* (Yjs queues the
    // operations) but produces "Invalid access" warnings on subsequent
    // reads. Two-phase avoids the noise.
    const blockMaps = doc.body.map((block, i) =>
      buildSkeletonBlockYMap(ids[i] ?? "", block),
    );
    if (blockMaps.length > 0) body.insert(0, blockMaps);
    for (let i = 0; i < doc.body.length; i++) {
      populateBlockContent(blockMaps[i]!, doc.body[i]!);
    }

    // Meta — JSON-encoded for v0.1
    meta.set(Y_META_FIELDS.sections, JSON.stringify(doc.sections));
    meta.set(Y_META_FIELDS.headerFooterBodies, JSON.stringify(doc.headerFooterBodies));
    meta.set(Y_META_FIELDS.anchoredFrames, JSON.stringify(doc.anchoredFrames ?? []));
    meta.set(Y_META_FIELDS.headerFooterFrames, JSON.stringify(doc.headerFooterFrames ?? {}));
    meta.set(Y_META_FIELDS.styles, JSON.stringify(doc.styles));
    meta.set(Y_META_FIELDS.numbering, JSON.stringify(doc.numbering));
    meta.set(Y_META_FIELDS.fonts, JSON.stringify(doc.fonts));

    // Parts (binary) — Y supports Uint8Array natively
    for (const [path, bytes] of Object.entries(doc.rawParts)) {
      parts.set(path, bytes);
    }
  }, /* origin */ "seed");
}

/**
 * Build a *skeleton* block Y.Map — id + kind discriminator + empty
 * containers, no content. Content lands in `populateBlockContent`
 * after the map is integrated. Used internally by `seedYDoc` and by
 * `applyDocumentToYDoc` (`buildBlockYMap` is a one-shot wrapper that
 * does both phases on an orphan map; only safe for callers that will
 * insert it inside a transact within the same call stack).
 */
export function buildSkeletonBlockYMap(id: string, block: Block): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set(Y_BLOCK_ID_KEY, id);
  if (block.kind === "paragraph") {
    m.set(Y_BLOCK_KIND_KEY, "paragraph");
    m.set(Y_BLOCK_TEXT_KEY, new Y.Text());
    // Props go in populateBlockContent; we set the kind here so
    // anyone projecting from a skeleton sees the right discriminator.
  }
  // Non-paragraph: no skeleton needed; populateBlockContent will set _ast.
  return m;
}

/** Populate the content of an *integrated* block Y.Map. */
export function populateBlockContent(map: Y.Map<unknown>, block: Block): void {
  if (block.kind === "paragraph") {
    populateParagraphContent(map, block);
  } else {
    map.set(Y_BLOCK_AST_KEY, JSON.stringify(block));
  }
}

/**
 * Populate paragraph content. Caller guarantees the map is integrated
 * (so its child Y.Text is too).
 */
export function populateParagraphContent(
  map: Y.Map<unknown>,
  block: Paragraph,
): void {
  // Properties.
  map.set(Y_BLOCK_PROPS_KEY, JSON.stringify(block.properties));
  // Text — must already exist on the map (set by buildSkeletonBlockYMap).
  let text = map.get(Y_BLOCK_TEXT_KEY);
  if (!(text instanceof Y.Text)) {
    text = new Y.Text();
    map.set(Y_BLOCK_TEXT_KEY, text);
  }
  const delta = runsToDelta(block.runs);
  if (delta.length > 0) {
    (text as Y.Text).applyDelta(
      delta as Array<{ insert: unknown; attributes?: object }>,
    );
  }
}

/**
 * One-shot block Y.Map builder — skeleton + content in a single call.
 * Only safe inside a `Y.Doc.transact` block where the returned map
 * will be inserted into an integrated parent before any read of its
 * Y.Text. Otherwise prefer the two-phase builders above.
 *
 * Kept for backwards compat with callers that don't yet use the
 * two-phase pattern.
 */
export function buildBlockYMap(id: string, block: Block): Y.Map<unknown> {
  const m = buildSkeletonBlockYMap(id, block);
  populateBlockContent(m, block);
  return m;
}

/**
 * @deprecated Use `populateParagraphContent` (renamed for clarity).
 * Kept as a re-export so callers don't break during migration.
 */
export const populateParagraphYMap = populateParagraphContent;
