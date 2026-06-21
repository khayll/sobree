import { describe, expect, it } from "vitest";
import { serializeInlineChildren } from "./inline";

function host(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("serializeInlineChildren — font-family", () => {
  it("takes the first family from a fallback chain and strips its quotes", () => {
    // The renderer emits a full fallback chain; the readback must recover
    // the ORIGINAL family name — not `Myriad Pro Cond'` with a stray quote.
    const el = host(
      `<span style="font-family:'Myriad Pro Cond', 'Arial Narrow', 'Helvetica Neue', sans-serif">Hi</span>`,
    );
    const runs = serializeInlineChildren(el);
    expect(runs).toHaveLength(1);
    expect((runs[0] as { properties: { fontFamily?: string } }).properties.fontFamily).toBe(
      "Myriad Pro Cond",
    );
  });

  it("handles an unquoted single family", () => {
    const runs = serializeInlineChildren(host(`<span style="font-family:Arial">x</span>`));
    expect((runs[0] as { properties: { fontFamily?: string } }).properties.fontFamily).toBe(
      "Arial",
    );
  });
});
