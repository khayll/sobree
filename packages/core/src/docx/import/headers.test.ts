import { describe, expect, it } from "vitest";
import { flattenZone, readSection } from "./headers";

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

describe("readSection — <w:cols>", () => {
  it("reads num + space into columns", () => {
    const sectPr = new DOMParser().parseFromString(
      `<?xml version="1.0"?><w:sectPr xmlns:w="${NS_W}">
        <w:cols w:num="2" w:space="708"/>
      </w:sectPr>`,
      "application/xml",
    ).documentElement;
    const section = readSection(sectPr, new Map());
    expect(section.columns).toEqual({ count: 2, spaceTwips: 708 });
  });

  it("omits columns when num <= 1 (single-column is the default)", () => {
    const sectPr = new DOMParser().parseFromString(
      `<?xml version="1.0"?><w:sectPr xmlns:w="${NS_W}">
        <w:cols w:num="1" w:space="708"/>
      </w:sectPr>`,
      "application/xml",
    ).documentElement;
    const section = readSection(sectPr, new Map());
    expect(section.columns).toBeUndefined();
  });

  it("omits spaceTwips when not specified", () => {
    const sectPr = new DOMParser().parseFromString(
      `<?xml version="1.0"?><w:sectPr xmlns:w="${NS_W}">
        <w:cols w:num="3"/>
      </w:sectPr>`,
      "application/xml",
    ).documentElement;
    const section = readSection(sectPr, new Map());
    expect(section.columns).toEqual({ count: 3 });
  });

  it("reads unequal per-column widths from <w:col> when equalWidth=0", () => {
    const sectPr = new DOMParser().parseFromString(
      `<?xml version="1.0"?><w:sectPr xmlns:w="${NS_W}">
        <w:cols w:num="2" w:space="720" w:equalWidth="0">
          <w:col w:w="6576" w:space="720"/>
          <w:col w:w="2928"/>
        </w:cols>
      </w:sectPr>`,
      "application/xml",
    ).documentElement;
    const section = readSection(sectPr, new Map());
    expect(section.columns).toEqual({
      count: 2,
      spaceTwips: 720,
      equalWidth: false,
      columns: [{ widthTwips: 6576, spaceTwips: 720 }, { widthTwips: 2928 }],
    });
  });

  it("stays on the equal path when equalWidth is not 0 (stray <w:col> ignored)", () => {
    const sectPr = new DOMParser().parseFromString(
      `<?xml version="1.0"?><w:sectPr xmlns:w="${NS_W}">
        <w:cols w:num="2" w:space="708"><w:col w:w="4680"/></w:cols>
      </w:sectPr>`,
      "application/xml",
    ).documentElement;
    const section = readSection(sectPr, new Map());
    expect(section.columns).toEqual({ count: 2, spaceTwips: 708 });
  });

  it("falls back to equal when the <w:col> count doesn't match num", () => {
    const sectPr = new DOMParser().parseFromString(
      `<?xml version="1.0"?><w:sectPr xmlns:w="${NS_W}">
        <w:cols w:num="3" w:equalWidth="0"><w:col w:w="4680"/><w:col w:w="4680"/></w:cols>
      </w:sectPr>`,
      "application/xml",
    ).documentElement;
    const section = readSection(sectPr, new Map());
    expect(section.columns).toEqual({ count: 3 });
  });
});

/**
 * Regression coverage for the field-flattening path. The header/footer
 * importer reduces a `<w:hdr>` / `<w:ftr>` XML body into a string with
 * `{page}` / `{pages}` tokens, which `templateToBlocks` then materialises
 * into the JSON-clean `Block[]` template the renderer consumes.
 *
 * Bugs caught here in the past:
 *   - Cached display values inside complex fields (between `separate`
 *     and `end`) leaked out as literal text adjacent to the field token,
 *     producing footers like `"21. / 44. oldal"` instead of the expected
 *     `"1. / 4. oldal"` (the literal cached "2" / "4" prepended onto the
 *     resolved field value).
 */
describe("flattenZone", () => {
  it("strips cached display values from complex PAGE/NUMPAGES fields", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:ftr xmlns:w="${NS_W}">
  <w:p>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText>PAGE</w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="separate"/></w:r>
    <w:r><w:t>2</w:t></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
    <w:r><w:t>. / </w:t></w:r>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText>NUMPAGES</w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="separate"/></w:r>
    <w:r><w:t>4</w:t></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
    <w:r><w:t>. oldal</w:t></w:r>
  </w:p>
</w:ftr>`;
    expect(flattenZone(xml)).toBe("{page}. / {pages}. oldal");
  });

  it("handles fldSimple (single-element) fields", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:ftr xmlns:w="${NS_W}">
  <w:p>
    <w:r><w:t>Page </w:t></w:r>
    <w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple>
    <w:r><w:t> of </w:t></w:r>
    <w:fldSimple w:instr="NUMPAGES"><w:r><w:t>4</w:t></w:r></w:fldSimple>
  </w:p>
</w:ftr>`;
    expect(flattenZone(xml)).toBe("Page {page} of {pages}");
  });

  it("preserves literal text outside fields", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:ftr xmlns:w="${NS_W}">
  <w:p>
    <w:r><w:t>Confidential</w:t></w:r>
  </w:p>
</w:ftr>`;
    expect(flattenZone(xml)).toBe("Confidential");
  });

  it("ignores unrecognised field instructions (just emits empty)", () => {
    // `DATE` isn't a known token — fieldToToken returns "", so the
    // entire field collapses to nothing. Adjacent literal text survives.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:ftr xmlns:w="${NS_W}">
  <w:p>
    <w:r><w:t>x </w:t></w:r>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText>DATE</w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="separate"/></w:r>
    <w:r><w:t>2024-01-01</w:t></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
    <w:r><w:t> y</w:t></w:r>
  </w:p>
</w:ftr>`;
    expect(flattenZone(xml)).toBe("x  y");
  });
});
