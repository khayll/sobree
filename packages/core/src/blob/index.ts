/**
 * @sobree/core blob module — content-hashed binary parts.
 *
 * Without configuring a `BlobStore`, Sobree behaves as it always has:
 * binary parts (images, fonts) live inline in `SobreeDocument.rawParts`
 * and inside the Y.Doc's `parts: Y.Map<Uint8Array>`.
 *
 * With a `BlobStore` configured on `createSobree({ blobStore })`,
 * Sobree shifts to *content-hashed* mode: bytes go to the BlobStore
 * (the side channel) and the Y.Doc stores only SHA-256 hashes
 * (`partRefs: Y.Map<string, string>`). Y updates stay small — a
 * 5 MB image paste no longer means 5 MB on every peer's Y.Doc.
 *
 * Two reference implementations ship out of the box:
 *
 *   - `inMemoryBlobStore()` — tests, local-only deployments
 *   - `fetchBlobStore({ baseUrl, headers })` — HTTP backend
 *
 * For production at scale, write a custom `BlobStore` against S3 /
 * R2 / Postgres / Redis. The interface is three methods.
 *
 * The `BlobCache` class bridges the async `BlobStore` and the
 * synchronous editor renderer — pre-fetch with `ensureLoaded`, read
 * synchronously after.
 */

export type { BlobHash, BlobStore } from "./types";
export { BlobStoreError } from "./types";
export { sha256Hex, isBlobHash } from "./hash";
export { inMemoryBlobStore } from "./memory";
export { fetchBlobStore } from "./fetch";
export type { FetchBlobStoreOptions } from "./fetch";
export { BlobCache } from "./cache";
export type { BlobCacheOptions } from "./cache";
