import { describe, expect, it } from "vitest";
import { readRunProperties } from "./runProperties";

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** Parse an inline `<w:rPr>…</w:rPr>` fragment into its element. */
function rPrFromXml(inner: string): Element {
  return new DOMParser().parseFromString(
    `<w:rPr xmlns:w="${NS_W}">${inner}</w:rPr>`,
    "application/xml",
  ).documentElement;
}

describe("readRunProperties — the single <w:rPr> reader", () => {
  it("reads tri-state toggles (present / explicit-off / absent)", () => {
    expect(readRunProperties(rPrFromXml("<w:b/>"))?.bold).toBe(true);
    expect(readRunProperties(rPrFromXml('<w:b w:val="0"/>'))?.bold).toBe(false);
    expect(readRunProperties(rPrFromXml("<w:i/>"))?.italic).toBe(true);
    // Absent element → the field is unspecified, not false.
    expect(readRunProperties(rPrFromXml("<w:i/>"))?.bold).toBeUndefined();
    expect(readRunProperties(rPrFromXml("<w:caps/>"))?.caps).toBe(true);
    expect(readRunProperties(rPrFromXml('<w:strike w:val="false"/>'))?.strike).toBe(false);
  });

  it("returns undefined for an empty rPr", () => {
    expect(readRunProperties(rPrFromXml(""))).toBeUndefined();
  });

  // Divergence fix #1: the old direct-run reader collapsed EVERY underline
  // to boolean → "single", losing double/dotted/dashed/wave. The unified
  // reader keeps the enum for BOTH homes (run + style).
  it("keeps the underline STYLE enum, not just a boolean", () => {
    expect(readRunProperties(rPrFromXml('<w:u w:val="double"/>'))?.underline).toBe("double");
    expect(readRunProperties(rPrFromXml('<w:u w:val="dotted"/>'))?.underline).toBe("dotted");
    // Bare <w:u/> is single by OOXML default.
    expect(readRunProperties(rPrFromXml("<w:u/>"))?.underline).toBe("single");
    // Unknown style coerces to the closest renderable (single).
    expect(readRunProperties(rPrFromXml('<w:u w:val="dashLong"/>'))?.underline).toBe("single");
    // Explicit none leaves underline unset.
    expect(readRunProperties(rPrFromXml('<w:u w:val="none"/>'))?.underline).toBeUndefined();
  });

  // Divergence fix #2: the old direct-run reader DROPPED color="auto", so a
  // run resetting an inherited colour back to automatic stayed coloured. The
  // unified reader keeps "auto" (renderer maps it to currentColor).
  it("keeps color=auto and normalises hex to #rrggbb", () => {
    expect(readRunProperties(rPrFromXml('<w:color w:val="auto"/>'))?.color).toBe("auto");
    expect(readRunProperties(rPrFromXml('<w:color w:val="FF0000"/>'))?.color).toBe("#FF0000");
    expect(readRunProperties(rPrFromXml('<w:color w:val="#00FF00"/>'))?.color).toBe("#00FF00");
  });

  it("reads rStyle, highlight, vertAlign, and half-point sizes", () => {
    expect(readRunProperties(rPrFromXml('<w:rStyle w:val="Emphasis"/>'))?.styleId).toBe("Emphasis");
    expect(readRunProperties(rPrFromXml('<w:highlight w:val="yellow"/>'))?.highlight).toBe(
      "yellow",
    );
    expect(readRunProperties(rPrFromXml('<w:highlight w:val="none"/>'))?.highlight).toBeUndefined();
    expect(readRunProperties(rPrFromXml('<w:vertAlign w:val="superscript"/>'))?.verticalAlign).toBe(
      "superscript",
    );
    expect(readRunProperties(rPrFromXml('<w:sz w:val="22"/>'))?.fontSizePt).toBe(11);
  });

  it("reads rFonts, preferring ascii and falling back to hAnsi", () => {
    expect(
      readRunProperties(rPrFromXml('<w:rFonts w:ascii="Georgia" w:hAnsi="Arial"/>'))?.fontFamily,
    ).toBe("Georgia");
    // ascii absent → fall back to hAnsi (the old style reader dropped this).
    expect(readRunProperties(rPrFromXml('<w:rFonts w:hAnsi="Arial"/>'))?.fontFamily).toBe("Arial");
  });

  it("recurses into a <w:rPrChange> format-revision snapshot", () => {
    const props = readRunProperties(
      rPrFromXml(
        '<w:b/><w:rPrChange w:author="A" w:date="2020-01-01T00:00:00Z"><w:rPr><w:i/></w:rPr></w:rPrChange>',
      ),
    );
    expect(props?.bold).toBe(true);
    expect(props?.revisionFormat?.author).toBe("A");
    expect(props?.revisionFormat?.before.italic).toBe(true);
    // The snapshot itself carries no nested revisionFormat.
    expect(props?.revisionFormat?.before.revisionFormat).toBeUndefined();
  });
});
