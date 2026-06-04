import { sha256Hex } from "../../blob";
import { pruneOrphanParts } from "../../doc/parts";
import type { SobreeDocument } from "../../doc/types";
import {
  type EmbedFontFaces,
  type EmbedFontOptions,
  embedFontIntoDoc,
  removeFontFromDoc,
} from "../../fonts";
import { Y_PARTS_KEY, applyPartRefsToYDoc } from "../../ydoc";
import type { EditorContext } from "../context";

/**
 * Binary-part lifecycle: font embedding, orphan pruning, and the
 * content-blob (`BlobStore`) migration path. When a `BlobStore` is
 * configured, inline part bytes are mirrored to the store by content
 * hash and referenced via `partRefs` instead of living inline in the
 * Y.Doc; `resolveCachedPartRefsInto` / `onBlobResolved` patch bytes
 * back into `doc.rawParts` as they arrive so the renderer stays
 * synchronous. With no `BlobStore` (the default) the migration paths are
 * no-ops and bytes are always inline.
 */

/** Patch any cached blob bytes for known partRefs into `doc.rawParts`. */
export function resolveCachedPartRefsInto(ctx: EditorContext, doc: SobreeDocument): void {
  if (!ctx.blobCache) return;
  for (const [path, hash] of Object.entries(ctx.lastPartRefs)) {
    if (doc.rawParts[path]) continue; // inline-parts entry wins if both present
    const bytes = ctx.blobCache.get(hash);
    if (bytes) doc.rawParts[path] = bytes;
  }
}

/**
 * Callback fired by the BlobCache when a background fetch lands. Walks
 * `lastPartRefs` to find which paths reference this hash, patches
 * `doc.rawParts`, and re-renders so the user sees the part appear.
 */
export function onBlobResolved(ctx: EditorContext, hash: string): void {
  if (!ctx.blobCache) return;
  let touched = false;
  for (const [path, refHash] of Object.entries(ctx.lastPartRefs)) {
    if (refHash !== hash) continue;
    const bytes = ctx.blobCache.get(hash);
    if (bytes && !ctx.doc.rawParts[path]) {
      ctx.doc.rawParts[path] = bytes;
      touched = true;
    }
  }
  if (!touched) return;
  // Re-render so the renderer picks up the freshly-resolved part. Full
  // re-render; a future pass can scope it to just the affected parts.
  ctx.renderCurrent();
  ctx.emitChangeNow();
}

/**
 * Wait for every currently-referenced binary part to be available in
 * the local cache. Useful before `toDocx()` so the exported file
 * contains all images / fonts. Resolves immediately when no `blobStore`
 * is configured (bytes are always inline).
 */
export async function ensurePartsLoaded(ctx: EditorContext): Promise<void> {
  if (!ctx.blobCache) return;
  const hashes = Object.values(ctx.lastPartRefs);
  if (hashes.length === 0) return;
  await ctx.blobCache.ensureLoaded(hashes);
  resolveCachedPartRefsInto(ctx, ctx.doc);
}

/**
 * Drop entries from `rawParts` that nothing in the AST references.
 * Idempotent; reports the keys removed. Not auto-invoked — `exportDocx`
 * filters at packaging time, so callers only need this when keeping the
 * doc in-memory across many edits.
 */
export function pruneUnusedParts(ctx: EditorContext): { kept: number; pruned: string[] } {
  const { doc, kept, pruned } = pruneOrphanParts(ctx.doc);
  if (pruned.length === 0) return { kept, pruned };
  ctx.setDoc(doc);
  ctx.mirrorToYDoc();
  return { kept, pruned };
}

/**
 * Embed a TTF/OTF font into the document. Thin wrapper around
 * `embedFontIntoDoc()` — handles the `setDocument` round so the renderer
 * + `@font-face` registry pick up the new face, and migrates the added
 * part bytes to the BlobStore when one is configured. Refuses (with a
 * warning) restricted fonts unless `opts.allowRestricted`.
 */
export function embedFont(
  ctx: EditorContext,
  name: string,
  faces: EmbedFontFaces,
  opts: EmbedFontOptions = {},
): { warnings: string[] } {
  const before = ctx.doc.rawParts;
  const result = embedFontIntoDoc(ctx.doc, name, faces, opts);
  if (result.next !== ctx.doc) {
    // Diff which part paths the font module just added — candidates for
    // migration to the BlobStore.
    const addedPartPaths: Array<{ path: string; bytes: Uint8Array }> = [];
    if (ctx.blobStore && ctx.blobCache) {
      for (const [path, bytes] of Object.entries(result.next.rawParts)) {
        if (!before[path]) addedPartPaths.push({ path, bytes });
      }
      for (const { path } of addedPartPaths) {
        ctx.pendingPartRefMigrations.add(path);
      }
    }
    ctx.setDocument(result.next);
    for (const { path, bytes } of addedPartPaths) {
      void migratePartToBlobStore(ctx, path, bytes);
    }
  }
  return { warnings: result.warnings };
}

/**
 * Drop a font declaration by name. The associated font parts aren't
 * removed immediately — call `pruneUnusedParts()` (or export) to GC them.
 */
export function removeEmbeddedFont(ctx: EditorContext, name: string): void {
  const next = removeFontFromDoc(ctx.doc, name);
  if (next !== ctx.doc) ctx.setDocument(next);
}

/**
 * Part paths the Y.Doc mirror must NOT write inline — they're (or will
 * soon be) tracked via `partRefs` instead. Returns `undefined` when
 * there's nothing to skip (the common no-BlobStore case) so the mirror
 * takes its fastest path.
 */
export function computePartPathSkipSet(ctx: EditorContext): ReadonlySet<string> | undefined {
  if (ctx.pendingPartRefMigrations.size === 0) {
    const refKeys = Object.keys(ctx.lastPartRefs);
    if (refKeys.length === 0) return undefined;
    return new Set(refKeys);
  }
  const out = new Set<string>(Object.keys(ctx.lastPartRefs));
  for (const p of ctx.pendingPartRefMigrations) out.add(p);
  return out;
}

/**
 * Background-migrate inline part bytes into the BlobStore. Called by
 * mutators (`insertImage`, `embedFont`) when a `BlobStore` is configured.
 * The local `doc.rawParts` keeps its inline copy so the renderer stays
 * synchronous; the Y.Doc gets a `partRefs` entry referencing the
 * content hash and any stale `parts` entry is deleted.
 *
 * Robust against errors: an upload failure logs and leaves the path in
 * the pending set so a future call can retry.
 */
export async function migratePartToBlobStore(
  ctx: EditorContext,
  partPath: string,
  bytes: Uint8Array,
): Promise<void> {
  if (!ctx.blobStore || !ctx.blobCache) return;
  ctx.pendingPartRefMigrations.add(partPath);
  try {
    const hash = await sha256Hex(bytes);
    ctx.blobCache.put(hash, bytes);
    await ctx.blobStore.put(bytes);
    ctx.ydoc.transact(() => {
      // Write the partRef (the new authoritative reference).
      applyPartRefsToYDoc(ctx.ydoc, { [partPath]: hash }, "local");
      // Delete any stale inline parts entry. The mirror's skip set
      // prevents re-introducing it.
      ctx.ydoc.getMap<Uint8Array>(Y_PARTS_KEY).delete(partPath);
    }, "local");
    ctx.setLastPartRefs({ ...ctx.lastPartRefs, [partPath]: hash });
  } catch (err) {
    console.error(`[sobree] failed to migrate part ${partPath} to BlobStore:`, err);
  } finally {
    ctx.pendingPartRefMigrations.delete(partPath);
  }
}
