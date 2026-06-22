import { beforeEach, describe, expect, it } from "vitest";

import type { AnchoredFrame } from "../doc/types";
import { DEFAULT_PAGE_SETUP } from "./pageSetup";
import { type AnchorRenderDeps, PaperStack, collapseTrailingEmptyPages } from "./paperStack";

// vitest is configured with `environment: "jsdom"`, so `window.document`
// is available globally — no need to import jsdom directly.
const doc = window.document;

beforeEach(() => {
  doc.body.innerHTML = "";
});

function p(text: string): HTMLElement {
  const el = doc.createElement("p");
  if (text) el.textContent = text;
  return el;
}

function paraWithImg(): HTMLElement {
  const el = doc.createElement("p");
  const img = doc.createElement("img");
  el.appendChild(img);
  return el;
}

describe("collapseTrailingEmptyPages", () => {
  it("absorbs a trailing all-empty page into the previous page", () => {
    const pages = [[p("alpha")], [p(""), p("")]];
    const out = collapseTrailingEmptyPages(pages);
    expect(out).toHaveLength(1);
    expect(out[0]?.map((el) => el.textContent ?? "")).toEqual(["alpha", "", ""]);
  });

  it("leaves a real last page alone", () => {
    const pages = [[p("alpha")], [p("signature")]];
    const out = collapseTrailingEmptyPages(pages);
    expect(out).toHaveLength(2);
  });

  it("absorbs a MIDDLE all-empty page into the next page", () => {
    // This is the complex-multipage CV case: a `<w:br type="page"/>`
    // forces a page break, the paragraph after it is empty, paginator
    // emits a page for that empty para — LO collapses it, we should too.
    const pages = [[p("alpha")], [p(""), p("")], [p("gamma")]];
    const out = collapseTrailingEmptyPages(pages);
    expect(out).toHaveLength(2);
    // Empty paragraphs preserve document order — prepended to next page.
    expect(out[1]?.map((el) => el.textContent ?? "")).toEqual(["", "", "gamma"]);
  });

  it("keeps pages with embedded images even when text is empty", () => {
    // An empty <p> wrapping a drawing-anchored image is visually
    // meaningful — must not collapse.
    const pages = [[p("alpha")], [paraWithImg()], [p("gamma")]];
    const out = collapseTrailingEmptyPages(pages);
    expect(out).toHaveLength(3);
  });

  it("keeps pages with section-frame drawing wrappers", () => {
    // The textbox-only project pages in complex-multipage.docx render
    // as <p> wrapping a [class*='sobree-section-frame'] div. Must NOT
    // be collapsed — these pages are intentionally drawing-only.
    const para = doc.createElement("p");
    const frame = doc.createElement("div");
    frame.className = "sobree-section-frame sobree-section-frame--banner";
    para.appendChild(frame);
    const pages = [[p("alpha")], [para], [p("gamma")]];
    const out = collapseTrailingEmptyPages(pages);
    expect(out).toHaveLength(3);
  });

  it("keeps pages with data-sobree-drawing wrappers", () => {
    const para = doc.createElement("p");
    const drawing = doc.createElement("div");
    drawing.setAttribute("data-sobree-drawing", "1");
    para.appendChild(drawing);
    const pages = [[p("alpha")], [para], [p("gamma")]];
    const out = collapseTrailingEmptyPages(pages);
    expect(out).toHaveLength(3);
  });

  it("handles consecutive middle empty pages", () => {
    const pages = [[p("alpha")], [p("")], [p("")], [p("gamma")]];
    const out = collapseTrailingEmptyPages(pages);
    expect(out).toHaveLength(2);
    expect(out[0]?.[0]?.textContent).toBe("alpha");
    expect(out[1]?.map((el) => el.textContent ?? "")).toEqual(["", "", "gamma"]);
  });

  it("is idempotent on already-collapsed input", () => {
    const pages = [[p("alpha")], [p("gamma")]];
    const first = collapseTrailingEmptyPages(pages);
    const second = collapseTrailingEmptyPages(first);
    expect(second).toEqual(first);
  });
});

describe("PaperStack anchored frames — independent of header/footer rich zones", () => {
  const deps: AnchorRenderDeps = { rawParts: {}, numbering: [], styles: [] };
  const bgFrame: AnchoredFrame = {
    id: "bg",
    anchor: { sectionIndex: 0, horizontalFrom: "page", verticalFrom: "page" },
    offsetXEmu: 0,
    offsetYEmu: 0,
    widthEmu: 914400,
    heightEmu: 914400,
    behindText: true,
    content: { kind: "shape", geometry: "rect", fill: "#A4C639" },
  };

  it("paints floating frames when the document has NO rich zones", () => {
    // Regression: `paintAnchorLayers` used to gate on `this.richZones`,
    // so a header/footer-less document (e.g. the trifold brochure) silently
    // dropped 100% of its anchored drawings — full-page background images,
    // watermarks, shapes. Frames are body content, orthogonal to zones.
    const container = doc.createElement("div");
    doc.body.appendChild(container);
    const stack = new PaperStack(container, DEFAULT_PAGE_SETUP);
    stack.setRichZones(null); // no headers/footers
    stack.setAnchoredFrames([bgFrame], deps);
    expect(container.querySelectorAll(".paper-anchor")).toHaveLength(1);
  });

  it("clears the floating layer when frames are null", () => {
    const container = doc.createElement("div");
    doc.body.appendChild(container);
    const stack = new PaperStack(container, DEFAULT_PAGE_SETUP);
    stack.setAnchoredFrames([bgFrame], deps);
    stack.setAnchoredFrames(null, deps);
    expect(container.querySelectorAll(".paper-anchor")).toHaveLength(0);
  });
});
