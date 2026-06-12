---
title: BlobStore (content-hashed binary parts)
description: Move image and font bytes out of Y.Doc updates into a side-channel store.
---

By default Sobree stores binary parts (images, fonts) **inline**:
they live in `SobreeDocument.rawParts` and inside the Y.Doc's `parts`
Y.Map. Every byte replicates to every peer through Y updates. Fine
for small docs. Painful for a doc with a 5 MB image — that 5 MB
replicates to every peer on every update.

You can opt into content-hashed parts. Pass a
`BlobStore` to `createSobree({ blobStore })` and Sobree:

1. Hashes each new binary part with SHA-256.
2. Uploads the bytes to the BlobStore (your S3, your HTTP endpoint,
   wherever).
3. Writes only the hash into the Y.Doc's `partRefs` Y.Map.
4. Other peers receiving the partRef fetch the bytes via the same
   BlobStore on demand.

Y updates stay tiny regardless of image size.

## When to use it

- **Production at scale**, especially with image-heavy docs.
- **Multi-room servers** where many docs share assets (logos,
  templates) — content-addressed dedup is free.
- **Network-constrained collab** where every byte counts.

If your docs are text-only, or images are rare and small, you can
skip this entirely. The default inline path works.

## Quick start

```ts
import { createSobree, fetchBlobStore } from "@sobree/core";
import { keyboard } from "@sobree/keyboard";
import { blockTools } from "@sobree/block-tools";

const editor = createSobree("#editor", {
  blobStore: fetchBlobStore({
    baseUrl: "https://blobs.yourdomain.com",
    headers: async () => ({ authorization: `Bearer ${await getToken()}` }),
  }),
  plugins: [keyboard(), blockTools()],
});

// Pasting an image works as always — the editor hashes, uploads,
// writes the partRef in the background. Y peers see the partRef,
// fetch the bytes via the same BlobStore.
```

## The BlobStore interface

Three methods, two optional:

```ts
interface BlobStore {
  put(bytes: Uint8Array): Promise<BlobHash>;
  get(hash: BlobHash): Promise<Uint8Array | null>;
  has?(hash: BlobHash): Promise<boolean>;
  delete?(hash: BlobHash): Promise<void>;
}
```

`BlobHash` is a SHA-256 hex digest (lowercase, 64 chars).

`put` is **idempotent**: same bytes → same hash → no-op after the
first call. `get` returns `null` for missing blobs (not an error).

## Reference implementations

### `inMemoryBlobStore()`

```ts
import { inMemoryBlobStore } from "@sobree/core";
const store = inMemoryBlobStore();
```

Pure in-memory map. Useful for tests, single-tab dev playgrounds,
and as a caching layer wrapped around a remote store.

### `fetchBlobStore({ baseUrl, headers, fetch })`

HTTP backend — `PUT/GET/HEAD/DELETE <baseUrl>/<hash>`.

```ts
import { fetchBlobStore } from "@sobree/core";
const store = fetchBlobStore({
  baseUrl: "https://blobs.example.com",
  headers: () => ({ authorization: `Bearer ${myToken}` }),
});
```

The optional `headers` factory runs **per request** so token-refresh
patterns work without re-creating the store. Pass a custom `fetch`
for testing or non-standard runtimes.

The server is responsible for validating that the URL hash matches
the body hash on PUT (server-side hash-trust isn't safe). For
Sobree-shipped servers, this validation lives in
`@sobree/collab-server`. For third-party /
S3-style stores you typically use **path-style content addressing
with pre-signed URLs** and skip the server-side check.

## Writing a custom BlobStore

The interface is small. An S3 backend in ~30 lines:

```ts
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { sha256Hex, type BlobStore } from "@sobree/core";

export function s3BlobStore(opts: { bucket: string; client: S3Client }): BlobStore {
  return {
    async put(bytes) {
      const hash = await sha256Hex(bytes);
      await opts.client.send(new PutObjectCommand({
        Bucket: opts.bucket,
        Key: hash,
        Body: bytes,
      }));
      return hash;
    },
    async get(hash) {
      try {
        const res = await opts.client.send(new GetObjectCommand({
          Bucket: opts.bucket, Key: hash,
        }));
        const buf = await res.Body!.transformToByteArray();
        return new Uint8Array(buf);
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
  };
}
```

Same shape for R2, Postgres LO, Redis, or anything else.

## How it works internally

1. **`insertImage(at, bytes)` / `embedFont(name, faces)`**:
   - Synchronously: bytes go into `doc.rawParts[partPath]` so the
     local renderer paints them immediately.
   - In the background: hash the bytes, upload to the BlobStore,
     write `partRefs[partPath] = hash` to the Y.Doc, and delete any
     stale inline `parts[partPath]` entry. All in one Y transaction.
2. **The mirror** (`mirrorToYDoc`) tracks part paths that have been
   migrated (or are mid-migration) and skips them — so the Y.Doc
   never gets duplicated bytes inline alongside the partRef.
3. **Remote peers** receiving the partRef immediately see the
   reference in `editor.editor.lastPartRefs`. If they have the same
   BlobStore configured, a background fetch via `BlobCache` brings
   the bytes in; the renderer re-renders when they land.
4. **`editor.ensurePartsLoaded()`** is the async hook for
   "block until every referenced part is in the local cache" — call
   it before `toDocx()` if you want the export to contain all
   referenced images / fonts.

## API

### `EditorOptions.blobStore` / `CreateSobreeOptions.blobStore`

Optional `BlobStore`. Default: undefined (inline parts in Y.Doc).

### `SobreeHandle.ensurePartsLoaded()`

```ts
ensurePartsLoaded(): Promise<void>
```

Resolves once every currently-referenced binary part is in the local
cache. Returns immediately when no BlobStore is configured.

### `editor.blobStore` / `editor.blobCache`

Read-only access to the configured store + cache. `null` when no
BlobStore is set.

### Companion exports

| export | role |
|---|---|
| `FetchBlobStoreOptions` | `fetchBlobStore` config — `baseUrl`, `headers`, custom `fetch`. |
| `BlobCacheOptions` | `BlobCache` construction options for custom wiring. |
| `BlobStoreError` | Error class store implementations should throw — callers can `instanceof` it. |
| `isBlobHash(value)` | Type guard for `BlobHash` strings — useful when validating `partRefs` entries in a custom store. |

### Y.Doc schema

When `BlobStore` is configured, the Y.Doc carries:

```
ydoc.getMap("parts")     : Y.Map<Uint8Array>   — legacy inline (empty for new docs)
ydoc.getMap("partRefs")  : Y.Map<string>       — partPath → hash
```

Both maps coexist — projection unions them, so a Y.Doc with legacy
inline parts from a no-BlobStore peer reads correctly alongside
hash-addressed parts.

## Current limitations

- **No reference counting / garbage collection.** Deleting an
  image from the doc leaves the partRef entry; if the bytes are no
  longer referenced anywhere, the BlobStore still retains them.
  There is no built-in pass that walks the doc, finds unreferenced
  partRefs, and deletes them from the store.
- **No hash verification on fetch.** The cache trusts the BlobStore;
  fetched bytes are not re-hashed to reject mismatches.
- **In-memory cache only.** The `BlobCache` is purely in-memory, so
  a reload means re-fetching from the BlobStore. There is no
  persistent (e.g. IndexedDB-backed) cache across reloads.
- **`toDocx()` is synchronous.** It reads from the cache snapshot.
  Embedders call `await ensurePartsLoaded()` first if they want
  guaranteed completeness; there is no single async `toDocx()` that
  folds these together.

## Related

- [Architecture: deployment tiers](/concepts/architecture/#deployment-tiers)
- [`createSobree()`](/api/create-sobree/#ydoc--collaboration)
- [HeadlessSobree](/api/headless/) — also accepts `blobStore`
- [`@sobree/collab-server`](/api/collab-server/) — ships a
  server-side validating blob endpoint
