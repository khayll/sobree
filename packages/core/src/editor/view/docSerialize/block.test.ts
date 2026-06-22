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

describe("serializeHostsToDocument — multi-column section un-wrap", () => {
  const bodyText = (b: { kind: string; runs?: { kind: string; text?: string }[] }) =>
    (b as Paragraph).runs?.map((r) => (r.kind === "text" ? r.text : "")).join("") ?? "";

  it("un-wraps `.sobree-cols` tracks back to flat blocks in document order", () => {
    // What `flowColumnSections` produces for a 2-column section: a wrapper
    // with two `.sobree-col` tracks, each holding WHOLE paragraphs. The
    // readback must recover the flat paragraph sequence — col0 then col1
    // (snaking = document order) — not one merged paragraph.
    const h = host(`
      <div class="sobree-cols sobree-section-col">
        <div class="sobree-col"><p>A</p><p>B</p></div>
        <div class="sobree-col"><p>C</p><p>D</p></div>
      </div>`);
    const body = serializeHostsToDocument([h]).body;
    expect(body).toHaveLength(4);
    expect(body.map(bodyText)).toEqual(["A", "B", "C", "D"]);
  });

  it("keeps the section's blocks distinct when the wrapper sits between section breaks", () => {
    const h = host(`
      <p>intro</p>
      <div class="sobree-section-break" contenteditable="false"></div>
      <div class="sobree-cols">
        <div class="sobree-col"><p>col one</p></div>
        <div class="sobree-col"><p>col two</p></div>
      </div>
      <div class="sobree-section-break" contenteditable="false"></div>
      <p>outro</p>`);
    const body = serializeHostsToDocument([h]).body;
    expect(body.map((b) => b.kind)).toEqual([
      "paragraph",
      "section_break",
      "paragraph",
      "paragraph",
      "section_break",
      "paragraph",
    ]);
    expect(body.filter((b) => b.kind === "paragraph").map(bodyText)).toEqual([
      "intro",
      "col one",
      "col two",
      "outro",
    ]);
  });

  it("falls back to direct children for a pristine wrapper (no tracks yet)", () => {
    const h = host(`<div class="sobree-cols"><p>X</p><p>Y</p></div>`);
    expect(serializeHostsToDocument([h]).body.map(bodyText)).toEqual(["X", "Y"]);
  });
});

describe("serializeHostsToDocument — section-break toSectionIndex", () => {
  it("reconstructs each break's target section index (Nth break → section N)", () => {
    // The renderer reads a break's page-break-vs-continuous behaviour from
    // `sections[toSectionIndex]`, so the read-back must recover the real
    // index. A hardcoded 0 made every break resolve to section 0 (default
    // next-page), exploding a continuous-section doc into one page per
    // section on the next re-render.
    const h = host(`
      <p>section zero</p>
      <div class="sobree-section-break" contenteditable="false"></div>
      <p>section one</p>
      <div class="sobree-section-break" contenteditable="false"></div>
      <p>section two</p>`);
    const body = serializeHostsToDocument([h]).body;
    const breaks = body.filter((b) => b.kind === "section_break") as {
      kind: "section_break";
      toSectionIndex: number;
    }[];
    expect(breaks.map((b) => b.toSectionIndex)).toEqual([1, 2]);
  });
});
