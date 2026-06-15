/**
 * HTTP-backed BlobStore — `fetch()` against a base URL.
 *
 * Wire format (hash-addressable):
 *
 *   PUT  <baseUrl>/<hash>   body = bytes,         response = 2xx
 *   GET  <baseUrl>/<hash>   response = bytes
 *   HEAD <baseUrl>/<hash>   response = 2xx (exists) or 404 (missing)
 *
 * The server is responsible for verifying that the URL hash matches
 * the body hash on PUT (server-side hash-trust isn't safe). For
 * Sobree-shipped servers, this validation lives in
 * `@sobree/collab-server` (Phase 3.2.x). For third-party / S3-style
 * stores you'll typically use *path-style content addressing* with
 * pre-signed URLs and skip the server-side check.
 *
 * # Auth
 *
 * The optional `headers` factory runs on every request — return any
 * `Authorization`, `Cookie`, signed-URL params, etc. Recomputed each
 * time so token-refresh patterns work without re-creating the store.
 *
 * # Retry / backoff
 *
 * Not built into the store — that's the `BlobCache` layer's job
 * (where it has context about whether the missing blob is critical
 * or speculative). The store reports failure honestly via thrown
 * `BlobStoreError` (non-2xx) or `null` (404).
 */

import { isBlobHash } from "./hash";
import { type BlobHash, type BlobStore, BlobStoreError } from "./types";

export interface FetchBlobStoreOptions {
  /** Base URL — bytes are addressed at `<baseUrl>/<hash>`. No trailing slash. */
  baseUrl: string;
  /**
   * Optional headers factory. Called per request — embed auth tokens,
   * trace IDs, custom content types, etc. Defaults to no extra headers.
   */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Pass through to the underlying `fetch` (CORS mode, signal, etc.). */
  fetchInit?: RequestInit;
  /**
   * Override the global `fetch`. Useful for testing or running inside
   * a runtime with a custom fetch impl. Default: `globalThis.fetch`.
   */
  fetch?: typeof fetch;
}

export function fetchBlobStore(opts: FetchBlobStoreOptions): BlobStore {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("fetchBlobStore: no global `fetch` available. Pass one via opts.fetch.");
  }

  const buildHeaders = async (extra?: Record<string, string>): Promise<Record<string, string>> => {
    const dynamic = opts.headers ? await opts.headers() : {};
    return { ...dynamic, ...extra };
  };

  const url = (hash: BlobHash) => {
    if (!isBlobHash(hash)) {
      throw new BlobStoreError(`fetchBlobStore: invalid hash ${JSON.stringify(hash)}`);
    }
    return `${baseUrl}/${hash}`;
  };

  return {
    async put(bytes) {
      // Hash on the client. The server may re-hash to verify; we
      // address by the client-computed hash so the URL is
      // deterministic before the body is read.
      const { sha256Hex } = await import("./hash");
      const hash = await sha256Hex(bytes);
      const headers = await buildHeaders({
        "content-type": "application/octet-stream",
      });
      const res = await fetchImpl(url(hash), {
        method: "PUT",
        body: bytes as unknown as BodyInit,
        headers,
        ...opts.fetchInit,
      });
      if (!res.ok) {
        throw new BlobStoreError(
          `fetchBlobStore.put(${hash}) failed: ${res.status} ${res.statusText}`,
        );
      }
      return hash;
    },

    async get(hash) {
      const headers = await buildHeaders();
      const res = await fetchImpl(url(hash), {
        method: "GET",
        headers,
        ...opts.fetchInit,
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new BlobStoreError(
          `fetchBlobStore.get(${hash}) failed: ${res.status} ${res.statusText}`,
        );
      }
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    },

    async has(hash) {
      const headers = await buildHeaders();
      const res = await fetchImpl(url(hash), {
        method: "HEAD",
        headers,
        ...opts.fetchInit,
      });
      if (res.status === 404) return false;
      if (!res.ok) {
        throw new BlobStoreError(
          `fetchBlobStore.has(${hash}) failed: ${res.status} ${res.statusText}`,
        );
      }
      return true;
    },

    async delete(hash) {
      const headers = await buildHeaders();
      const res = await fetchImpl(url(hash), {
        method: "DELETE",
        headers,
        ...opts.fetchInit,
      });
      if (res.status === 404) return; // already absent
      if (!res.ok) {
        throw new BlobStoreError(
          `fetchBlobStore.delete(${hash}) failed: ${res.status} ${res.statusText}`,
        );
      }
    },
  };
}
