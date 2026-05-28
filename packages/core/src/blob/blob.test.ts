import { describe, expect, it, vi } from "vitest";
import { BlobCache } from "./cache";
import { fetchBlobStore } from "./fetch";
import { isBlobHash, sha256Hex } from "./hash";
import { inMemoryBlobStore } from "./memory";
import { BlobStoreError } from "./types";

// === sha256Hex ===

describe("sha256Hex", () => {
  it("matches NIST test vectors", async () => {
    // Empty input → known digest
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    // "abc" → known digest (ASCII bytes)
    const abc = new TextEncoder().encode("abc");
    expect(await sha256Hex(abc)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hex digest is always 64 lowercase chars", async () => {
    for (const text of ["", "a", "Hello", "🦀", "x".repeat(10_000)]) {
      const bytes = new TextEncoder().encode(text);
      const hash = await sha256Hex(bytes);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("identical bytes produce identical hashes", async () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(await sha256Hex(a)).toBe(await sha256Hex(b));
  });

  it("different bytes produce different hashes", async () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 5]);
    expect(await sha256Hex(a)).not.toBe(await sha256Hex(b));
  });

  it("handles a Uint8Array view into a larger buffer", async () => {
    // Sub-array slicing — sha should hash only the view, not the
    // whole underlying buffer.
    const big = new Uint8Array([0, 0, 1, 2, 3, 0, 0]);
    const view = big.subarray(2, 5); // [1, 2, 3]
    const standalone = new Uint8Array([1, 2, 3]);
    expect(await sha256Hex(view)).toBe(await sha256Hex(standalone));
  });
});

describe("isBlobHash", () => {
  it("accepts valid hashes", () => {
    expect(isBlobHash("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")).toBe(true);
  });
  it("rejects wrong length", () => {
    expect(isBlobHash("abc")).toBe(false);
    expect(isBlobHash("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85")).toBe(false);
  });
  it("rejects uppercase / non-hex", () => {
    expect(isBlobHash("E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855")).toBe(false);
    expect(isBlobHash("z3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")).toBe(false);
  });
});

// === inMemoryBlobStore ===

describe("inMemoryBlobStore", () => {
  it("put round-trips through get", async () => {
    const store = inMemoryBlobStore();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const hash = await store.put(bytes);
    expect(isBlobHash(hash)).toBe(true);
    const got = await store.get(hash);
    expect(got).toEqual(bytes);
  });

  it("get returns null for missing hash", async () => {
    const store = inMemoryBlobStore();
    expect(await store.get("a".repeat(64))).toBeNull();
  });

  it("put is idempotent", async () => {
    const store = inMemoryBlobStore();
    const bytes = new Uint8Array([1, 2, 3]);
    const h1 = await store.put(bytes);
    const h2 = await store.put(bytes);
    expect(h1).toBe(h2);
  });

  it("has reports presence cheaply", async () => {
    const store = inMemoryBlobStore();
    expect(await store.has?.("a".repeat(64))).toBe(false);
    const hash = await store.put(new Uint8Array([0]));
    expect(await store.has?.(hash)).toBe(true);
  });

  it("delete removes the blob", async () => {
    const store = inMemoryBlobStore();
    const hash = await store.put(new Uint8Array([0]));
    await store.delete?.(hash);
    expect(await store.get(hash)).toBeNull();
  });

  it("put defensively copies — caller mutation doesn't poison cache", async () => {
    const store = inMemoryBlobStore();
    const bytes = new Uint8Array([1, 2, 3]);
    const hash = await store.put(bytes);
    bytes[0] = 99;
    const got = await store.get(hash);
    expect(got?.[0]).toBe(1);
  });
});

// === fetchBlobStore (no real HTTP, just verify the fetch contract) ===

describe("fetchBlobStore", () => {
  it("PUTs bytes at <baseUrl>/<hash>", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 200 });
    });
    const store = fetchBlobStore({
      baseUrl: "https://blob.example.com",
      fetch: fakeFetch as unknown as typeof fetch,
    });
    const bytes = new TextEncoder().encode("abc");
    const hash = await store.put(bytes);
    expect(hash).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe(`https://blob.example.com/${hash}`);
    expect(calls[0]?.init.method).toBe("PUT");
  });

  it("GET returns null on 404", async () => {
    const fakeFetch = vi.fn(
      async () => new Response(null, { status: 404 }) as Response,
    );
    const store = fetchBlobStore({
      baseUrl: "https://blob.example.com",
      fetch: fakeFetch as unknown as typeof fetch,
    });
    const got = await store.get("a".repeat(64));
    expect(got).toBeNull();
  });

  it("GET returns bytes on 200", async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const fakeFetch = vi.fn(
      async () => new Response(payload, { status: 200 }) as Response,
    );
    const store = fetchBlobStore({
      baseUrl: "https://blob.example.com",
      fetch: fakeFetch as unknown as typeof fetch,
    });
    const got = await store.get("a".repeat(64));
    expect(got).toEqual(payload);
  });

  it("non-2xx (non-404) throws BlobStoreError", async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(null, { status: 500, statusText: "internal" }) as Response,
    );
    const store = fetchBlobStore({
      baseUrl: "https://blob.example.com",
      fetch: fakeFetch as unknown as typeof fetch,
    });
    await expect(store.get("a".repeat(64))).rejects.toBeInstanceOf(BlobStoreError);
  });

  it("calls headers factory on each request", async () => {
    let calls = 0;
    const fakeFetch = vi.fn(
      async () => new Response(null, { status: 200 }) as Response,
    );
    const store = fetchBlobStore({
      baseUrl: "https://blob.example.com",
      fetch: fakeFetch as unknown as typeof fetch,
      headers: () => {
        calls++;
        return { authorization: `Bearer t-${calls}` };
      },
    });
    await store.put(new Uint8Array([0]));
    await store.get("a".repeat(64));
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("rejects bad hashes on get/has/delete", async () => {
    const store = fetchBlobStore({
      baseUrl: "https://blob.example.com",
      fetch: (async () => new Response()) as unknown as typeof fetch,
    });
    await expect(store.get("not-a-hash")).rejects.toBeInstanceOf(BlobStoreError);
  });
});

// === BlobCache ===

describe("BlobCache", () => {
  it("get returns null when hash absent", () => {
    const cache = new BlobCache({ store: inMemoryBlobStore() });
    expect(cache.get("a".repeat(64))).toBeNull();
  });

  it("put + get round-trip is synchronous", async () => {
    const cache = new BlobCache({ store: inMemoryBlobStore() });
    const bytes = new Uint8Array([1, 2, 3]);
    const hash = await sha256Hex(bytes);
    cache.put(hash, bytes);
    expect(cache.get(hash)).toEqual(bytes);
  });

  it("ensureLoaded fetches from the store for missing hashes", async () => {
    const store = inMemoryBlobStore();
    const bytes = new Uint8Array([9, 8, 7]);
    const hash = await store.put(bytes);
    const cache = new BlobCache({ store });
    expect(cache.has(hash)).toBe(false);
    await cache.ensureLoaded([hash]);
    expect(cache.has(hash)).toBe(true);
    expect(cache.get(hash)).toEqual(bytes);
  });

  it("ensureLoaded is a no-op for already-cached hashes", async () => {
    const store = inMemoryBlobStore();
    const bytes = new Uint8Array([5]);
    const hash = await store.put(bytes);
    const cache = new BlobCache({ store });
    cache.put(hash, bytes);
    // Replace the store's get with a spy — should not be called.
    const spy = vi.spyOn(store, "get");
    await cache.ensureLoaded([hash]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("dedupes concurrent fetches of the same hash", async () => {
    const store = inMemoryBlobStore();
    const bytes = new Uint8Array([5]);
    const hash = await store.put(bytes);
    let gets = 0;
    const wrapped = {
      ...store,
      get: async (h: string) => {
        gets++;
        return store.get(h);
      },
    };
    const cache = new BlobCache({ store: wrapped });
    await Promise.all([
      cache.ensureLoaded([hash]),
      cache.ensureLoaded([hash]),
      cache.ensureLoaded([hash]),
    ]);
    // First call fetches; the other two share the in-flight Promise.
    expect(gets).toBe(1);
  });

  it("fires onResolved when a fetch lands", async () => {
    const store = inMemoryBlobStore();
    const bytes = new Uint8Array([1]);
    const hash = await store.put(bytes);
    const resolved: string[] = [];
    const cache = new BlobCache({
      store,
      onResolved: (h) => resolved.push(h),
    });
    await cache.ensureLoaded([hash]);
    expect(resolved).toEqual([hash]);
  });

  it("missing blob (store returns null) does NOT throw", async () => {
    const cache = new BlobCache({ store: inMemoryBlobStore() });
    // The store doesn't have this hash; ensureLoaded should resolve
    // without throwing, leaving the hash uncached.
    await cache.ensureLoaded(["a".repeat(64)]);
    expect(cache.has("a".repeat(64))).toBe(false);
  });

  it("fetch error fires onError and does NOT throw from ensureLoaded", async () => {
    const errs: Array<[string, unknown]> = [];
    const failing = {
      put: async () => "x",
      get: async () => {
        throw new Error("boom");
      },
      has: async () => false,
    };
    const cache = new BlobCache({
      store: failing,
      onError: (h, err) => errs.push([h, err]),
    });
    await cache.ensureLoaded(["a".repeat(64)]);
    expect(errs.length).toBe(1);
    expect((errs[0]?.[1] as Error).message).toBe("boom");
  });

  it("clear empties cache + in-flight tracking", () => {
    const cache = new BlobCache({ store: inMemoryBlobStore() });
    cache.put("a".repeat(64), new Uint8Array([1]));
    expect(cache.size()).toBe(1);
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});
