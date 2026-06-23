import type * as Y from "yjs";
import type { SobreeDocument } from "../doc/types";
import { buildBlockSkeleton, populateBlock } from "./blockCodec";
import { buildFrameSkeleton, buildFrames, populateFrames } from "./frameCodec";
import {
  Y_ANCHORED_FRAMES_KEY,
  Y_BODY_KEY,
  Y_HEADER_FOOTER_FRAMES_KEY,
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
    throw new Error(`seedYDoc: ids length (${ids.length}) !== body length (${doc.body.length})`);
  }
  const body = ydoc.getArray<Y.Map<unknown>>(Y_BODY_KEY);
  const meta = ydoc.getMap<string>(Y_META_KEY);
  const parts = ydoc.getMap<Uint8Array>(Y_PARTS_KEY);
  const frames = ydoc.getArray<Y.Map<unknown>>(Y_ANCHORED_FRAMES_KEY);
  const hfFrames = ydoc.getMap<Y.Array<Y.Map<unknown>>>(Y_HEADER_FOOTER_FRAMES_KEY);

  ydoc.transact(() => {
    // Reset
    if (body.length > 0) body.delete(0, body.length);
    for (const k of [...meta.keys()]) meta.delete(k);
    for (const k of [...parts.keys()]) parts.delete(k);
    if (frames.length > 0) frames.delete(0, frames.length);
    for (const k of [...hfFrames.keys()]) hfFrames.delete(k);

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
    const blockMaps = doc.body.map((block, i) => buildBlockSkeleton(ids[i] ?? "", block));
    if (blockMaps.length > 0) body.insert(0, blockMaps);
    for (let i = 0; i < doc.body.length; i++) {
      populateBlock(blockMaps[i]!, doc.body[i]!);
    }

    // Floating layer — nested Y (per-frame CRDT), NOT meta JSON. Two-phase
    // like the body: build skeletons, integrate, then populate text deltas.
    const anchored = doc.anchoredFrames ?? [];
    const frameMaps = anchored.map(buildFrameSkeleton);
    if (frameMaps.length > 0) frames.insert(0, frameMaps);
    populateFrames(frames, anchored);
    for (const [zone, zoneFrames] of Object.entries(doc.headerFooterFrames ?? {})) {
      const arr = buildFrames(zoneFrames);
      hfFrames.set(zone, arr);
      populateFrames(arr, zoneFrames);
    }

    // Meta — JSON-encoded for v0.1
    meta.set(Y_META_FIELDS.sections, JSON.stringify(doc.sections));
    meta.set(Y_META_FIELDS.headerFooterBodies, JSON.stringify(doc.headerFooterBodies));
    meta.set(Y_META_FIELDS.footnotes, JSON.stringify(doc.footnotes ?? {}));
    meta.set(Y_META_FIELDS.comments, JSON.stringify(doc.comments ?? {}));
    meta.set(Y_META_FIELDS.settings, JSON.stringify(doc.settings ?? {}));
    meta.set(Y_META_FIELDS.styles, JSON.stringify(doc.styles));
    meta.set(Y_META_FIELDS.numbering, JSON.stringify(doc.numbering));
    meta.set(Y_META_FIELDS.fonts, JSON.stringify(doc.fonts));

    // Parts (binary) — Y supports Uint8Array natively
    for (const [path, bytes] of Object.entries(doc.rawParts)) {
      parts.set(path, bytes);
    }
  }, /* origin */ "seed");
}
