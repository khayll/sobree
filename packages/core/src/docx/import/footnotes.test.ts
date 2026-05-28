import { describe, expect, it } from "vitest";
import { parseFootnotesXml } from "./footnotes";

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const ctx = { rels: new Map<string, string>() };

describe("parseFootnotesXml", () => {
  it("returns {} for missing xml", () => {
    expect(parseFootnotesXml(undefined, ctx)).toEqual({});
  });

  it("skips separator and continuationSeparator footnotes", () => {
    const xml = `<?xml version="1.0"?><w:footnotes xmlns:w="${NS_W}">
      <w:footnote w:type="separator" w:id="-1">
        <w:p><w:r><w:t>line</w:t></w:r></w:p>
      </w:footnote>
      <w:footnote w:type="continuationSeparator" w:id="0">
        <w:p><w:r><w:t>cont</w:t></w:r></w:p>
      </w:footnote>
    </w:footnotes>`;
    expect(parseFootnotesXml(xml, ctx)).toEqual({});
  });

  it("parses normal footnotes into id-keyed Block arrays", () => {
    const xml = `<?xml version="1.0"?><w:footnotes xmlns:w="${NS_W}">
      <w:footnote w:id="1">
        <w:p><w:r><w:t>First footnote.</w:t></w:r></w:p>
      </w:footnote>
      <w:footnote w:id="2">
        <w:p><w:r><w:t>Second footnote.</w:t></w:r></w:p>
        <w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p>
      </w:footnote>
    </w:footnotes>`;
    const out = parseFootnotesXml(xml, ctx);
    expect(Object.keys(out).sort()).toEqual(["1", "2"]);
    expect(out[1]?.length).toBe(1);
    expect(out[2]?.length).toBe(2);
    const firstRun = (out[1]?.[0] as { runs?: { text?: string }[] } | undefined)?.runs?.[0];
    expect(firstRun?.text).toBe("First footnote.");
  });

  it("ignores negative ids (reserved by Word)", () => {
    const xml = `<?xml version="1.0"?><w:footnotes xmlns:w="${NS_W}">
      <w:footnote w:id="-2">
        <w:p><w:r><w:t>reserved</w:t></w:r></w:p>
      </w:footnote>
    </w:footnotes>`;
    expect(parseFootnotesXml(xml, ctx)).toEqual({});
  });
});
