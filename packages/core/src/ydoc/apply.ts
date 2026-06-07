import * as Y from "yjs";
import type { Block, Paragraph, SobreeDocument } from "../doc/types";
import { runsToDelta } from "./runs";
import {
  buildSkeletonBlockYMap,
  populateBlockContent,
  populateParagraphContent,
} from "./seed";
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
import { diffApplyText } from "./textDiff";

/**
 * Apply a new SobreeDocument to a Y.Doc, diffing against the current
 * Y state by **block id**. The caller supplies the new id-per-block
 * array (typically derived from the BlockRegistry — see
 * `Editor.applyDocument`).
 *
 * # Granularity
 *
 *   - **Body blocks:** matched by id; updated in-place / inserted /
 *     removed. Concurrent edits to *different* blocks always merge
 *     cleanly via the Y.Array CRDT.
 *
 *   - **Paragraph block content:** the Y.Text is updated via
 *     `diffApplyText` — minimal `insert` / `delete` / `format`
 *     mutations matching what changed. Concurrent edits to *different
 *     positions* in the same paragraph merge cleanly. Concurrent
 *     edits to the *same* position still resolve via Yjs's standard
 *     ordering (later op wins per Yjs's deterministic conflict rules).
 *
 *   - **Paragraph properties (alignment, indent, …):** stored as a
 *     JSON blob on the Y.Map's `props` field. Concurrent property
 *     edits clobber. Phase 1c may split into per-key Y.Map.
 *
 *   - **Non-paragraph blocks (section_break, table):** stored as
 *     JSON-encoded `_ast`. Concurrent edits clobber.
 *
 *   - **Document meta (sections, styles, numbering, fonts,
 *     headerFooterBodies):** JSON-encoded on a `meta` Y.Map.
 *     Clobber on concurrent edits — these change rarely.
 *
 *   - **Binary parts (images, fonts):** stored as a Y.Map<Uint8Array>
 *     with adds / removes detected by key. Phase 3 moves these to a
 *     content-hashed blob store (out-of-band).
 *
 * The whole apply is wrapped in a single `Y.Doc.transact` with the
 * supplied origin so subscribers (UndoManager, change listeners) see
 * one batch.
 */
export interface ApplyDocumentOptions {
  /**
   * Part paths to **exclude** from the inline `parts` diff. Used when
   * a `BlobStore` is configured — paths already managed via `partRefs`
   * (or in-flight migration to it) must not also be written inline,
   * or the Y.Doc would carry duplicate bytes.
   *
   * Empty / absent: today's path — every `rawParts` entry mirrors
   * inline (no BlobStore).
   */
  skipPartPaths?: ReadonlySet<string>;
}

export function applyDocumentToYDoc(
  ydoc: Y.Doc,
  newDoc: SobreeDocument,
  newIds: readonly string[],
  origin: unknown = "applyDocument",
  opts: ApplyDocumentOptions = {},
): void {
  if (newIds.length !== newDoc.body.length) {
    throw new Error(
      `applyDocumentToYDoc: ids length (${newIds.length}) !== body length (${newDoc.body.length})`,
    );
  }
  const body = ydoc.getArray<Y.Map<unknown>>(Y_BODY_KEY);
  const meta = ydoc.getMap<string>(Y_META_KEY);
  const parts = ydoc.getMap<Uint8Array>(Y_PARTS_KEY);

  ydoc.transact(() => {
    diffBody(body, newDoc.body, newIds);
    diffMeta(meta, newDoc);
    diffParts(parts, newDoc.rawParts, opts.skipPartPaths);
  }, origin);
}

// === body diff ===

function diffBody(
  body: Y.Array<Y.Map<unknown>>,
  newBlocks: readonly Block[],
  newIds: readonly string[],
): void {
  // Determine which old ids survive in the new list.
  const newIdSet = new Set(newIds);

  // Walk old → drop blocks no longer present (right-to-left to preserve
  // indices during deletes).
  for (let i = body.length - 1; i >= 0; i--) {
    const m = body.get(i);
    const id = m.get(Y_BLOCK_ID_KEY) as string | undefined;
    if (!id || !newIdSet.has(id)) {
      body.delete(i, 1);
    }
  }

  // Walk new — for each desired (id, block) at index i:
  //   - if body[i] already has this id → update in-place
  //   - else if this id exists later in body → pull it forward
  //     (delete + reinsert; loses the Y.Map identity but block-level
  //     moves are rare)
  //   - else → fresh block; insert
  for (let i = 0; i < newBlocks.length; i++) {
    const desiredId = newIds[i] ?? "";
    const desiredBlock = newBlocks[i];
    if (!desiredBlock) continue;

    const current = i < body.length ? body.get(i) : undefined;
    const currentId = current
      ? ((current.get(Y_BLOCK_ID_KEY) as string | undefined) ?? "")
      : "";

    if (current && currentId === desiredId) {
      updateBlockInPlace(current, desiredBlock);
      continue;
    }

    // Mismatch — does desiredId exist somewhere later in body?
    const existingIdx = findIdAtOrAfter(body, desiredId, i);
    if (existingIdx !== -1) {
      // Pull it forward by delete + reinsert. Y.Array doesn't have a
      // move op, so the Y.Map identity is lost.
      body.delete(existingIdx, 1);
      insertFreshBlock(body, i, desiredId, desiredBlock);
      continue;
    }

    // Brand new block — insert.
    insertFreshBlock(body, i, desiredId, desiredBlock);
  }

  // Trim any extras (defensive — keeps the invariant
  // body.length === newBlocks.length).
  while (body.length > newBlocks.length) {
    body.delete(body.length - 1, 1);
  }
}

/**
 * Update an existing block Y.Map in-place to reflect a new Block.
 *
 * Branches by the Y.Map's current shape vs the new block's kind:
 *
 *   - both paragraph → diff text via Y.Text.diffApplyText; update
 *     props via JSON-set-if-changed
 *   - both non-paragraph → JSON-set-if-changed on `_ast`
 *   - kind change (paragraph ↔ other) → wipe + repopulate as the new
 *     shape (loses CRDT identity; uncommon)
 */
function updateBlockInPlace(map: Y.Map<unknown>, block: Block): void {
  const currentKind = map.get(Y_BLOCK_KIND_KEY) as string | undefined;
  const isCurrentParagraph =
    currentKind === "paragraph" || map.get(Y_BLOCK_TEXT_KEY) instanceof Y.Text;
  const isNewParagraph = block.kind === "paragraph";

  if (isCurrentParagraph && isNewParagraph) {
    updateParagraphInPlace(map, block);
    return;
  }

  if (!isCurrentParagraph && !isNewParagraph) {
    // Both non-paragraph: JSON-set if changed.
    const desiredAst = JSON.stringify(block);
    const currentAst = map.get(Y_BLOCK_AST_KEY) as string | undefined;
    if (currentAst !== desiredAst) map.set(Y_BLOCK_AST_KEY, desiredAst);
    return;
  }

  // Kind change. Wipe everything except `id` and rebuild. Order
  // matters: clear before re-populating, since a non-paragraph
  // Y.Map will have `_ast` and a paragraph Y.Map will have `text`/
  // `props`/`kind`.
  const id = (map.get(Y_BLOCK_ID_KEY) as string | undefined) ?? "";
  for (const key of [...map.keys()]) {
    if (key === Y_BLOCK_ID_KEY) continue;
    map.delete(key);
  }
  if (isNewParagraph) {
    // Set kind discriminator + create the Y.Text. The map IS
    // integrated (we're inside a transact running against a
    // body Y.Array), so the new Y.Text integrates immediately.
    map.set(Y_BLOCK_KIND_KEY, "paragraph");
    map.set(Y_BLOCK_TEXT_KEY, new Y.Text());
    populateParagraphContent(map, block);
  } else {
    map.set(Y_BLOCK_AST_KEY, JSON.stringify(block));
  }
  // Re-set id in case it was somehow cleared.
  if (!map.has(Y_BLOCK_ID_KEY)) map.set(Y_BLOCK_ID_KEY, id);
}

function updateParagraphInPlace(map: Y.Map<unknown>, paragraph: Paragraph): void {
  // Make sure the kind discriminator is set (forward-migration from
  // Phase 1a paragraph shape that didn't write a kind).
  if (map.get(Y_BLOCK_KIND_KEY) !== "paragraph") {
    map.set(Y_BLOCK_KIND_KEY, "paragraph");
  }

  // Text content via smart diff. The map is integrated (we're inside
  // a transact on body), so a freshly created Y.Text integrates
  // immediately on map.set — no "Invalid access" warnings.
  let text = map.get(Y_BLOCK_TEXT_KEY);
  if (!(text instanceof Y.Text)) {
    // First time on this map (e.g. migrating from Phase 1a `_ast`).
    text = new Y.Text();
    map.set(Y_BLOCK_TEXT_KEY, text);
    if (map.has(Y_BLOCK_AST_KEY)) map.delete(Y_BLOCK_AST_KEY);
  }
  diffApplyText(text as Y.Text, runsToDelta(paragraph.runs));

  // Properties via JSON-set if changed.
  const desiredProps = JSON.stringify(paragraph.properties);
  const currentProps = map.get(Y_BLOCK_PROPS_KEY) as string | undefined;
  if (currentProps !== desiredProps) map.set(Y_BLOCK_PROPS_KEY, desiredProps);
}

/**
 * Insert a fresh block at `index`, two-phase: skeleton in, then
 * content. The skeleton is integrated by the body.insert call, so
 * the subsequent populate operates on integrated Y types (no
 * "Invalid access" warnings).
 */
function insertFreshBlock(
  body: Y.Array<Y.Map<unknown>>,
  index: number,
  id: string,
  block: Block,
): void {
  const skeleton = buildSkeletonBlockYMap(id, block);
  body.insert(index, [skeleton]);
  populateBlockContent(skeleton, block);
}

function findIdAtOrAfter(
  body: Y.Array<Y.Map<unknown>>,
  id: string,
  startIdx: number,
): number {
  for (let i = startIdx; i < body.length; i++) {
    const m = body.get(i);
    if ((m.get(Y_BLOCK_ID_KEY) as string | undefined) === id) return i;
  }
  return -1;
}

// === meta diff ===

function diffMeta(meta: Y.Map<string>, doc: SobreeDocument): void {
  setIfChanged(meta, Y_META_FIELDS.sections, JSON.stringify(doc.sections));
  setIfChanged(
    meta,
    Y_META_FIELDS.headerFooterBodies,
    JSON.stringify(doc.headerFooterBodies),
  );
  setIfChanged(
    meta,
    Y_META_FIELDS.anchoredFrames,
    JSON.stringify(doc.anchoredFrames ?? []),
  );
  setIfChanged(
    meta,
    Y_META_FIELDS.headerFooterFrames,
    JSON.stringify(doc.headerFooterFrames ?? {}),
  );
  setIfChanged(meta, Y_META_FIELDS.footnotes, JSON.stringify(doc.footnotes ?? {}));
  setIfChanged(meta, Y_META_FIELDS.comments, JSON.stringify(doc.comments ?? {}));
  setIfChanged(meta, Y_META_FIELDS.settings, JSON.stringify(doc.settings ?? {}));
  setIfChanged(meta, Y_META_FIELDS.styles, JSON.stringify(doc.styles));
  setIfChanged(meta, Y_META_FIELDS.numbering, JSON.stringify(doc.numbering));
  setIfChanged(meta, Y_META_FIELDS.fonts, JSON.stringify(doc.fonts));
}

function setIfChanged(meta: Y.Map<string>, key: string, value: string): void {
  if (meta.get(key) !== value) meta.set(key, value);
}

// === parts diff ===

function diffParts(
  parts: Y.Map<Uint8Array>,
  next: Record<string, Uint8Array>,
  skip: ReadonlySet<string> | undefined,
): void {
  // Drop missing — but never touch a skipped path (it's managed via
  // partRefs; an explicit delete elsewhere clears any stale inline
  // entry).
  for (const k of [...parts.keys()]) {
    if (skip?.has(k)) continue;
    if (!(k in next)) parts.delete(k);
  }
  // Add / replace, skipping partRef-managed paths.
  for (const [path, bytes] of Object.entries(next)) {
    if (skip?.has(path)) continue;
    const existing = parts.get(path);
    if (!existing || !bytesEqual(existing, bytes)) parts.set(path, bytes);
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// === partRefs (Phase 3.2+) ===

/**
 * Atomically write `partRefs` entries to a Y.Doc's `partRefs` Y.Map.
 * Used by the Editor / HeadlessSobree when a `BlobStore` is configured —
 * the editor hashes new bytes, uploads via the store, then calls this
 * to publish the hash so other peers can fetch it.
 *
 * Wraps in `Y.Doc.transact` with the supplied origin so subscribers
 * (UndoManager, observers) see one batch.
 */
export function applyPartRefsToYDoc(
  ydoc: Y.Doc,
  partRefs: Record<string, string>,
  origin: unknown = "applyPartRefs",
): void {
  const target = ydoc.getMap<string>(Y_PARTREFS_KEY);
  ydoc.transact(() => {
    for (const [path, hash] of Object.entries(partRefs)) {
      if (target.get(path) !== hash) target.set(path, hash);
    }
  }, origin);
}

/**
 * Remove `partRefs` entries from a Y.Doc. Used when an embedder
 * prunes unreferenced parts.
 */
export function removePartRefsFromYDoc(
  ydoc: Y.Doc,
  paths: readonly string[],
  origin: unknown = "removePartRefs",
): void {
  if (paths.length === 0) return;
  const target = ydoc.getMap<string>(Y_PARTREFS_KEY);
  ydoc.transact(() => {
    for (const path of paths) target.delete(path);
  }, origin);
}
