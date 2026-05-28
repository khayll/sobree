/**
 * In-memory BlobStore. Useful for:
 *
 *   - Tests (predictable, no I/O).
 *   - Single-tab dev playgrounds where you want partRef semantics
 *     without standing up a server.
 *   - Layering: production embedders often wrap a remote BlobStore
 *     in a memory cache for speed; the in-memory store is the
 *     primitive for that pattern.
 *
 * Bytes stored here live for the lifetime of the BlobStore instance.
 * No persistence across reloads (use `attachIndexedDBProvider` or a
 * remote store for that).
 */

import { sha256Hex } from "./hash";
import type { BlobHash, BlobStore } from "./types";

export function inMemoryBlobStore(): BlobStore {
  // Defensive copy on `put` and (less importantly) `get` so callers
  // mutating their byte arrays after the call can't corrupt our state.
  // The cost is one Uint8Array allocation per call; negligible vs
  // the cost of moving binary content around.
  const store = new Map<BlobHash, Uint8Array>();

  return {
    async put(bytes) {
      const hash = await sha256Hex(bytes);
      if (!store.has(hash)) {
        store.set(hash, new Uint8Array(bytes));
      }
      return hash;
    },
    async get(hash) {
      const found = store.get(hash);
      return found ? new Uint8Array(found) : null;
    },
    async has(hash) {
      return store.has(hash);
    },
    async delete(hash) {
      store.delete(hash);
    },
  };
}
