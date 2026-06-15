/**
 * SHA-256 → lowercase hex helper that works in browsers, Web Workers,
 * and Node 18+ without external deps.
 *
 * # Backends
 *
 * Both code paths produce identical output; we pick by availability:
 *
 *   - **Node:** uses `node:crypto.createHash` when detected — fast,
 *     synchronous under the hood, immune to cross-realm typed-array
 *     issues that occasionally trip jsdom-hosted tests.
 *   - **Browser / Worker:** `globalThis.crypto.subtle.digest`. The
 *     standard WebCrypto API.
 *
 * The Node detection runs once at module load. The dynamic-import
 * dance keeps `node:crypto` out of browser bundles (bundlers leave
 * the `try { require(...) }` branch untouched and tree-shake it out
 * when targeting non-Node).
 */

import type { BlobHash } from "./types";

/**
 * Compute the SHA-256 hex digest of `bytes`. Lowercase hex, 64 chars.
 *
 * Always returns a Promise — the WebCrypto API is async, and we
 * shape the Node path the same way for API consistency.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<BlobHash> {
  const nodeImpl = await getNodeImpl();
  if (nodeImpl) return nodeImpl(bytes);
  return webCryptoSha256Hex(bytes);
}

async function webCryptoSha256Hex(bytes: Uint8Array): Promise<BlobHash> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "sha256Hex: WebCrypto unavailable. Sobree requires Node 18+ or a modern browser.",
    );
  }
  // Allocate a fresh current-realm ArrayBuffer and copy bytes
  // byte-by-byte. Avoids cross-realm typed-array checks that
  // SubtleCrypto impls sometimes get strict about (notably in jsdom
  // + Node webcrypto under vitest).
  const ABCtor = globalThis.ArrayBuffer;
  const Ctor = globalThis.Uint8Array;
  const copy = new ABCtor(bytes.byteLength);
  const view = new Ctor(copy);
  for (let i = 0; i < bytes.length; i++) view[i] = bytes[i]!;
  const buf = await subtle.digest("SHA-256", copy);
  return bufToHex(new Ctor(buf));
}

// === Node detection (cached) ===

type NodeImpl = (bytes: Uint8Array) => Promise<string>;
let nodeImplPromise: Promise<NodeImpl | null> | null = null;

function getNodeImpl(): Promise<NodeImpl | null> {
  if (nodeImplPromise !== null) return nodeImplPromise;
  nodeImplPromise = detectNodeImpl();
  return nodeImplPromise;
}

async function detectNodeImpl(): Promise<NodeImpl | null> {
  const proc: unknown = (globalThis as { process?: { versions?: { node?: string } } }).process;
  const isNode =
    typeof proc === "object" &&
    proc !== null &&
    typeof (proc as { versions?: { node?: string } }).versions?.node === "string";
  if (!isNode) return null;
  try {
    // Structural type for just the slice of `node:crypto` we touch — so
    // a browser-only consumer's `.d.ts` build (which type-checks this
    // source via the workspace dev-condition) doesn't need `@types/node`.
    // The specifier is held in a variable so TypeScript doesn't try to
    // statically resolve the `node:` module in a DOM-only type context;
    // the runtime import is unchanged.
    type NodeCrypto = {
      createHash(algorithm: string): {
        update(data: Uint8Array): { digest(encoding: string): string };
      };
    };
    const spec = "node:crypto";
    const c = (await import(/* @vite-ignore */ spec)) as NodeCrypto;
    return async (bytes: Uint8Array) => c.createHash("sha256").update(bytes).digest("hex");
  } catch {
    return null;
  }
}

// === hex encoding ===

function bufToHex(bytes: Uint8Array): string {
  const out = new Array<string>(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = HEX[bytes[i]!] ?? "";
  }
  return out.join("");
}

const HEX: string[] = (() => {
  const out: string[] = new Array(256);
  for (let i = 0; i < 256; i++) {
    out[i] = i.toString(16).padStart(2, "0");
  }
  return out;
})();

/**
 * Validate that a string looks like a SHA-256 hex digest. Used as a
 * defensive guard when bytes come from the wire.
 */
export function isBlobHash(s: string): boolean {
  return s.length === 64 && /^[0-9a-f]{64}$/.test(s);
}
