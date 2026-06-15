/**
 * BlobCache — a per-Editor in-memory cache mediating the Y.Doc-side
 * `partRefs: hash → name` model and the Editor-side `rawParts: name → bytes`
 * shape.
 *
 * # Why a cache
 *
 * The Editor's renderer wants synchronous byte access — when an
 * `<img>` is painted, the bytes have to be there. The `BlobStore` is
 * async (network, disk). The cache is the async-to-sync adapter:
 * embedders call `ensureLoaded(hashes)` to pre-fetch; subsequent
 * `get(hash)` calls are synchronous and cheap.
 *
 * # Lifecycle
 *
 *   1. Editor seeds the cache with bytes the user paste/embedded
 *      locally (writes go: `put(bytes)` → cache + background upload).
 *   2. On Y.Doc updates that reference a hash not yet cached, the
 *      Editor calls `ensureLoaded([hash])` to fetch in the background.
 *      A `change` event refires once the fetch lands so the renderer
 *      can re-paint.
 *   3. Embedders concerned with deterministic output (DOCX export,
 *      server-side render) `await ensureLoaded(allReferencedHashes)`
 *      before reading.
 *
 * # Memory bound
 *
 * Unbounded for v0 — same model as today's inline `rawParts` (which
 * is also unbounded). A future refinement would track hash usage
 * counts (incref on partRef references, decref on remove) and evict
 * unreferenced entries. Out of scope for Phase 3.2 v0.
 *
 * # Concurrent fetches
 *
 * Multiple `ensureLoaded([h])` calls for the same hash share one
 * in-flight Promise — we don't fetch the same blob N times.
 */

import type { BlobHash, BlobStore } from "./types";

export interface BlobCacheOptions {
  /** Underlying store. */
  store: BlobStore;
  /**
   * Optional listener fired when a previously-missing hash arrives in
   * the cache (background fetch landed). Editors use this to know
   * when to re-render — a `<img>` whose bytes were pending now has
   * something to show.
   */
  onResolved?: (hash: BlobHash) => void;
  /**
   * Optional listener fired when a fetch fails. The cache leaves the
   * hash in "missing" state and lets a future `ensureLoaded` retry.
   * Default: warn to console.
   */
  onError?: (hash: BlobHash, err: unknown) => void;
}

export class BlobCache {
  private readonly store: BlobStore;
  private readonly onResolved: (h: BlobHash) => void;
  private readonly onError: (h: BlobHash, err: unknown) => void;
  private readonly cache = new Map<BlobHash, Uint8Array>();
  /** In-flight fetches, keyed by hash. Promise resolves to the bytes
   *  (cached) or `null` (not found / error). */
  private readonly inflight = new Map<BlobHash, Promise<Uint8Array | null>>();

  constructor(opts: BlobCacheOptions) {
    this.store = opts.store;
    this.onResolved = opts.onResolved ?? (() => {});
    this.onError =
      opts.onError ?? ((h, err) => console.warn(`[blob-cache] fetch ${h} failed:`, err));
  }

  /**
   * Synchronously read bytes for a hash. Returns `null` if not yet
   * cached. Doesn't trigger a fetch — call `ensureLoaded` first if
   * you need to wait.
   */
  get(hash: BlobHash): Uint8Array | null {
    return this.cache.get(hash) ?? null;
  }

  /** Whether the hash is currently in the cache. */
  has(hash: BlobHash): boolean {
    return this.cache.has(hash);
  }

  /**
   * Insert bytes into the cache directly. Used when the embedder
   * already has the bytes in hand (paste image, font embed, DOCX
   * import) and wants the local renderer to find them immediately.
   *
   * Returns the bytes' hash. Caller is responsible for uploading
   * to the BlobStore separately (typically `await store.put(bytes)`
   * with the same input).
   */
  put(hash: BlobHash, bytes: Uint8Array): void {
    if (!this.cache.has(hash)) {
      this.cache.set(hash, new Uint8Array(bytes));
    }
  }

  /**
   * Ensure the given hashes are in the cache. Returns a Promise that
   * resolves once every hash is either in the cache or has failed to
   * fetch (failures don't reject the Promise — they're reported via
   * `onError` and skipped, consistent with the "best-effort
   * availability" model).
   *
   * Already-cached hashes resolve immediately. Already-in-flight
   * fetches are deduplicated (multiple concurrent callers wait on
   * the same Promise).
   */
  async ensureLoaded(hashes: readonly BlobHash[]): Promise<void> {
    const fetches: Promise<unknown>[] = [];
    for (const hash of hashes) {
      if (this.cache.has(hash)) continue;
      fetches.push(this.fetchOne(hash));
    }
    if (fetches.length === 0) return;
    await Promise.allSettled(fetches);
  }

  /**
   * Number of cached blobs. Diagnostic / test helper; production
   * code shouldn't depend on this for correctness.
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Clear all cached blobs. Used by the Editor on `destroy` to free
   * memory; future refinements may auto-evict.
   */
  clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  // === internals ===

  private fetchOne(hash: BlobHash): Promise<Uint8Array | null> {
    const existing = this.inflight.get(hash);
    if (existing) return existing;
    const promise = (async (): Promise<Uint8Array | null> => {
      try {
        const bytes = await this.store.get(hash);
        if (bytes) {
          this.cache.set(hash, bytes);
          this.onResolved(hash);
        }
        return bytes;
      } catch (err) {
        this.onError(hash, err);
        return null;
      } finally {
        this.inflight.delete(hash);
      }
    })();
    this.inflight.set(hash, promise);
    return promise;
  }
}
