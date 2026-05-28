import { describe, expect, it } from "vitest";
import {
  deobfuscate,
  generateFontKey,
  isUnobfuscated,
  obfuscate,
} from "./odttf";

const SAMPLE_KEY = "{302EE813-EB4A-4642-A93A-89EF99B2457E}";

function syntheticFont(size: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = i & 0xff;
  return out;
}

describe("ODTTF codec", () => {
  it("obfuscate ∘ deobfuscate is identity (round-trip)", () => {
    const ttf = syntheticFont(2048);
    const obf = obfuscate(ttf, SAMPLE_KEY);
    const back = deobfuscate(obf, SAMPLE_KEY);
    expect(back).toEqual(ttf);
  });

  it("deobfuscate ∘ obfuscate is identity (XOR is its own inverse)", () => {
    const ttf = syntheticFont(64);
    const a = deobfuscate(ttf, SAMPLE_KEY);
    const b = obfuscate(ttf, SAMPLE_KEY);
    // The transform is symmetric — naming is just for clarity.
    expect(a).toEqual(b);
  });

  it("only scrambles the first 32 bytes; tail passes through", () => {
    const ttf = syntheticFont(128);
    const obf = obfuscate(ttf, SAMPLE_KEY);
    // Bytes 32..end unchanged.
    expect(obf.slice(32)).toEqual(ttf.slice(32));
    // Bytes 0..32 differ from the original (vanishingly unlikely to match).
    expect(obf.slice(0, 32)).not.toEqual(ttf.slice(0, 32));
  });

  it("tolerates inputs shorter than 32 bytes", () => {
    const tiny = new Uint8Array([1, 2, 3, 4, 5]);
    const obf = obfuscate(tiny, SAMPLE_KEY);
    const back = deobfuscate(obf, SAMPLE_KEY);
    expect(back).toEqual(tiny);
  });

  it("does not mutate the input array", () => {
    const ttf = syntheticFont(64);
    const before = ttf.slice();
    obfuscate(ttf, SAMPLE_KEY);
    expect(ttf).toEqual(before);
  });

  it("rejects malformed keys", () => {
    expect(() => obfuscate(new Uint8Array(64), "not-a-guid")).toThrow();
  });

  it("accepts keys with or without braces / mixed case", () => {
    const ttf = syntheticFont(64);
    const a = obfuscate(ttf, SAMPLE_KEY);
    const b = obfuscate(ttf, SAMPLE_KEY.replace(/[{}]/g, ""));
    const c = obfuscate(ttf, SAMPLE_KEY.toLowerCase());
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });

  it("XOR is order-dependent on the key — different keys produce different output", () => {
    const ttf = syntheticFont(64);
    const a = obfuscate(ttf, SAMPLE_KEY);
    const b = obfuscate(ttf, "{00000000-0000-0000-0000-000000000001}");
    expect(a).not.toEqual(b);
  });
});

describe("generateFontKey", () => {
  it("returns a canonical {XX-...} GUID", () => {
    const key = generateFontKey();
    expect(key).toMatch(
      /^\{[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\}$/,
    );
  });

  it("each call returns a unique key", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 50; i++) keys.add(generateFontKey());
    expect(keys.size).toBe(50);
  });

  it("a generated key actually round-trips a font", () => {
    const ttf = syntheticFont(256);
    const key = generateFontKey();
    expect(deobfuscate(obfuscate(ttf, key), key)).toEqual(ttf);
  });
});

describe("isUnobfuscated", () => {
  it("returns true for the all-zero sentinel GUID", () => {
    expect(isUnobfuscated("{00000000-0000-0000-0000-000000000000}")).toBe(true);
  });
  it("returns true for undefined / empty", () => {
    expect(isUnobfuscated(undefined)).toBe(true);
    expect(isUnobfuscated("")).toBe(true);
  });
  it("returns false for any non-zero GUID", () => {
    expect(isUnobfuscated(SAMPLE_KEY)).toBe(false);
  });
});
