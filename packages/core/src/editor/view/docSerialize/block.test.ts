import { describe, expect, it } from "vitest";
import type { Paragraph } from "../../../doc/types";
import { serializeHostsToDocument } from "./index";

function host(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

const firstParagraph = (h: HTMLElement, opts?: { captureRunDefaults?: boolean }) =>
  serializeHostsToDocument([h], opts).body[0] as Paragraph;

describe("serializeHostsToDocument — captureRunDefaults (frame read-back)", () => {
  // The renderer's dominant-run cascade leaves the base font on the `<p>`
  // itself. A textbox frame has no named style to fall back on, so the
  // read-back must promote that font to `runDefaults` — otherwise a run
  // that loses its inline styling collapses the whole line to the default.
  const heading = `<p style="font-family:'Myriad Pro Cond', sans-serif; font-size:48pt; line-height:1.2; text-align:center"><span style="font-family:'Myriad Pro Cond'; font-size:48pt">Heading</span></p>`;

  it("promotes the paragraph's base font to runDefaults", () => {
    const p = firstParagraph(host(heading), { captureRunDefaults: true });
    expect(p.properties.runDefaults).toEqual({ fontFamily: "Myriad Pro Cond", fontSizePt: 48 });
  });

  it("survives a run that lost ALL inline styling (select-all-retype)", () => {
    // The styled span is gone; only a bare text node remains. The font now
    // lives solely on runDefaults, so a repaint won't shrink the line.
    const stripped = `<p style="font-family:'Myriad Pro Cond', sans-serif; font-size:48pt; line-height:1.2">NEW</p>`;
    const p = firstParagraph(host(stripped), { captureRunDefaults: true });
    expect(p.runs).toEqual([{ kind: "text", text: "NEW", properties: {} }]);
    expect(p.properties.runDefaults).toEqual({ fontFamily: "Myriad Pro Cond", fontSizePt: 48 });
  });

  it("ignores paragraph-only declarations (line-height, alignment)", () => {
    const p = firstParagraph(host(`<p style="line-height:2; text-align:center">x</p>`), {
      captureRunDefaults: true,
    });
    expect(p.properties.runDefaults).toBeUndefined();
  });

  it("leaves body flow untouched when the flag is off", () => {
    // Body runs stay style-linked: no runDefaults synthesised from the <p>.
    expect(firstParagraph(host(heading)).properties.runDefaults).toBeUndefined();
  });
});
