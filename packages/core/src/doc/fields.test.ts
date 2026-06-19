import { describe, expect, it } from "vitest";
import { fieldType } from "./fields";

describe("fieldType", () => {
  it("returns the bare field keyword, uppercased", () => {
    expect(fieldType("PAGE")).toBe("PAGE");
    expect(fieldType("page")).toBe("PAGE");
  });

  it("ignores formatting switches (the footer-page-number bug)", () => {
    // Word writes PAGE/NUMPAGES with `\* MERGEFORMAT` / `\* Arabic`; the
    // type must still resolve to the keyword so per-page substitution fires.
    expect(fieldType(" PAGE   \\* MERGEFORMAT ")).toBe("PAGE");
    expect(fieldType("NUMPAGES \\* Arabic")).toBe("NUMPAGES");
    expect(fieldType('DATE \\@ "d MMM yyyy"')).toBe("DATE");
  });

  it("handles empty / whitespace instructions", () => {
    expect(fieldType("")).toBe("");
    expect(fieldType("   ")).toBe("");
  });
});
