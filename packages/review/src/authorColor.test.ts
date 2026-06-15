import { describe, expect, it } from "vitest";
import { authorSlot, colorForAuthor } from "./authorColor";

describe("authorSlot", () => {
  it("returns slot 0 for an undefined author", () => {
    expect(authorSlot(undefined)).toBe(0);
  });

  it("is deterministic — same author always lands in the same slot", () => {
    expect(authorSlot("Alice")).toBe(authorSlot("Alice"));
    expect(authorSlot("Bob")).toBe(authorSlot("Bob"));
  });

  it("always returns a slot in range 0..7", () => {
    for (const name of ["Alice", "Bob", "Carol", "Dave", "Eve", "", "x", "Иван"]) {
      const slot = authorSlot(name);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(8);
      expect(Number.isInteger(slot)).toBe(true);
    }
  });
});

describe("colorForAuthor", () => {
  it("returns a --sobree-author token reference with a hex fallback", () => {
    expect(colorForAuthor("Alice")).toMatch(/^var\(--sobree-author-[0-7], #[0-9a-f]{6}\)$/);
  });

  it("references the slot that authorSlot computes", () => {
    const slot = authorSlot("Carol");
    expect(colorForAuthor("Carol")).toContain(`--sobree-author-${slot}`);
  });

  it("undefined author resolves to slot 0", () => {
    expect(colorForAuthor(undefined)).toContain("--sobree-author-0");
  });
});
