import { describe, expect, it } from "vitest";
import { resolveFontFace } from "./fontFallback";

describe("resolveFontFace", () => {
  it("keeps curated whole-name chains verbatim, with no implied weight", () => {
    // "Calibri Light" is a REAL family with its own calibrated chain —
    // corpus baselines depend on it staying chain-only.
    const r = resolveFontFace("Calibri Light");
    expect(r.stack).toContain("'Calibri Light', Carlito");
    expect(r.weight).toBeUndefined();
  });

  it("decomposes a face name into base family + implied weight", () => {
    const light = resolveFontFace("Helvetica Neue Light");
    // Full face name first (hosts shipping the exact face still use it),
    // then the base family's curated sans chain — NOT the serif default.
    expect(light.stack).toBe(
      "'Helvetica Neue Light', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    );
    expect(light.weight).toBe(300);

    expect(resolveFontFace("Helvetica Neue Medium").weight).toBe(500);
    expect(resolveFontFace("Helvetica Neue Bold").weight).toBe(700);
  });

  it("strips stacked tokens (weight + italic)", () => {
    const r = resolveFontFace("Helvetica Neue Light Italic");
    expect(r.weight).toBe(300);
    expect(r.italic).toBe(true);
  });

  it("face token on an unknown base keeps the face first and ends serif", () => {
    const r = resolveFontFace("Fancy Display Light");
    expect(r.stack).toBe("'Fancy Display Light', 'Fancy Display', serif");
    expect(r.weight).toBe(300);
  });

  it("unknown name with no tokens keeps the documented serif default", () => {
    expect(resolveFontFace("Bodoni 72")).toEqual({ stack: "'Bodoni 72', serif" });
  });

  it("never strips the whole name (single-word token names pass through)", () => {
    // "Light" alone is a (weird) family name, not a token suffix.
    expect(resolveFontFace("Light").stack).toBe("Light, serif");
  });
});
