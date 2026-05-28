/**
 * BlobStore — the side-channel where binary parts live when an
 * embedder configures Sobree for content-hashed assets (Phase 3.2+).
 *
 * # The contract
 *
 * Tiny, intentionally minimal. Three operations: `put` (returns the
 * content hash under which bytes are stored), `get` (fetches by
 * hash), and optional `has` (cheap existence check). Every reasonable
 * backend — in-memory, IndexedDB, HTTP, S3, R2, Cloudflare Workers,
 * Postgres LO, Redis — implements this.
 *
 * # Why content addressing
 *
 * Two reasons:
 *
 *   1. **Deduplication.** A 5 MB logo pasted into 100 docs lives once
 *      in the blob store, not 100 times. Hashes collide on identity,
 *      so identical bytes produce identical keys.
 *   2. **Tamper resistance.** A peer can verify any fetched blob by
 *      re-hashing — no trust in the storage layer required for
 *      integrity. (Confidentiality is a separate concern; encrypt at
 *      the transport / storage layer if you need it.)
 *
 * # Hash algorithm
 *
 * Sobree uses SHA-256 hex (lowercase, no separators) for blob
 * addressing. 64 chars per hash. Sized for the next decade or two of
 * web content; not so long that hashes are awkward to log or shove
 * into a URL path.
 *
 * # Concurrency
 *
 * Implementations should be safe for concurrent `put` of the same
 * content (multiple callers, same bytes → same hash, idempotent).
 * `get(hash)` must return the same bytes that were `put`.
 */

/** A SHA-256 hex digest. 64 lowercase hex chars. */
export type BlobHash = string;

export interface BlobStore {
  /**
   * Upload bytes and return their content hash. Idempotent — calling
   * `put` with the same bytes returns the same hash and is a no-op
   * after the first call.
   */
  put(bytes: Uint8Array): Promise<BlobHash>;

  /**
   * Fetch bytes by hash. Returns `null` when the blob isn't present
   * (e.g. another peer wrote the partRef but the bytes haven't
   * propagated yet). Implementations should NOT throw on "not
   * found" — return null.
   */
  get(hash: BlobHash): Promise<Uint8Array | null>;

  /**
   * Optional cheap existence check — returns `true` if a blob with
   * the given hash exists, without transferring its content. Used by
   * `BlobCache` to decide whether to schedule a fetch. Falls back to
   * `(await get(hash)) !== null` if not provided.
   */
  has?(hash: BlobHash): Promise<boolean>;

  /**
   * Optional removal. Most production deployments don't expose this
   * over the wire (blob deletion needs care: ref counting, garbage
   * collection, distributed coordination). Provided for tests and
   * local-only deployments where the embedder owns lifecycle.
   */
  delete?(hash: BlobHash): Promise<void>;
}

/**
 * BlobStoreError is thrown for low-level failures (transport,
 * authorization, integrity check). "Not found" is *not* an error —
 * `get` returns `null` for that case so callers can distinguish.
 */
export class BlobStoreError extends Error {
  constructor(
    message: string,
    /** Originating exception, network response, etc. */
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BlobStoreError";
  }
}
