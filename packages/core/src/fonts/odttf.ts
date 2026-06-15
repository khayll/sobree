/**
 * ODTTF (Obfuscated TrueType Font) codec for OOXML font embedding.
 *
 * Per ECMA-376 Part 4 §2.8.1: Word obfuscates embedded font binaries
 * by XORing the first 32 bytes with a 16-byte key derived from a GUID
 * (the `w:fontKey` attribute on `<w:embedRegular/>` / etc.). The key
 * is the GUID's 16 bytes in **reverse** order. The first 16 bytes of
 * the font are XOR'd with the key, then the next 16 bytes are XOR'd
 * with the same key. Bytes 32..end pass through unchanged.
 *
 * Symmetry — the operation is its own inverse (XOR is involutive), so
 * `obfuscate(deobfuscate(x, k), k) === x`.
 *
 * A `fontKey` of all-zeros means "no obfuscation" and the bytes are
 * already a raw TTF/OTF.
 */

const ALL_ZERO_KEY = "{00000000-0000-0000-0000-000000000000}";

/**
 * XOR-deobfuscate or -obfuscate the first 32 bytes of `bytes` with the
 * key derived from `fontKey`. Returns a fresh `Uint8Array` — the input
 * is not mutated.
 */
export function deobfuscate(bytes: Uint8Array, fontKey: string): Uint8Array {
  return transform(bytes, fontKey);
}

/** Symmetric inverse — same operation as `deobfuscate`, named for clarity at call sites. */
export function obfuscate(bytes: Uint8Array, fontKey: string): Uint8Array {
  return transform(bytes, fontKey);
}

/**
 * Generate a fresh GUID in the canonical `{XX-...}` form Word uses for
 * `w:fontKey`. Random bytes via `crypto.getRandomValues`; falls back to
 * `Math.random()` if `crypto` isn't present (jsdom often is, Node 19+
 * is too — fallback only matters for ancient runtimes).
 */
export function generateFontKey(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Conform to UUID v4 layout (per RFC 4122).
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}}`;
}

/** True when `fontKey` is the sentinel "no obfuscation" GUID. */
export function isUnobfuscated(fontKey: string | undefined): boolean {
  if (!fontKey) return true;
  return normaliseKey(fontKey) === ALL_ZERO_KEY.replace(/[^0-9a-f]/gi, "");
}

// ---------- internals ----------

function transform(bytes: Uint8Array, fontKey: string): Uint8Array {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  const key = keyToReversedBytes(fontKey);
  // 32 bytes total (two 16-byte chunks) get XOR'd. Bound by the actual
  // byte length so a sub-32-byte input doesn't overflow.
  const limit = Math.min(out.length, 32);
  for (let i = 0; i < limit; i++) {
    out[i] = (out[i] ?? 0) ^ (key[i % 16] ?? 0);
  }
  return out;
}

/**
 * Parse `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}` into the 16 raw bytes,
 * then **reverse** them — Word's byte order is the canonical hex
 * left-to-right read REVERSED, not .NET's `Guid.ToByteArray()` order.
 */
function keyToReversedBytes(fontKey: string): Uint8Array {
  const hex = normaliseKey(fontKey);
  if (hex.length !== 32) {
    throw new Error(`Invalid fontKey "${fontKey}" (expected 32 hex chars after stripping)`);
  }
  const fwd = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    fwd[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  // Reverse in place.
  const rev = new Uint8Array(16);
  for (let i = 0; i < 16; i++) rev[i] = fwd[15 - i] ?? 0;
  return rev;
}

function normaliseKey(fontKey: string): string {
  return fontKey.replace(/[{}\-]/g, "").toLowerCase();
}
