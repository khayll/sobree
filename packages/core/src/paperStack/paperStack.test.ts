import { beforeEach, describe, expect, it } from "vitest";

import { collapseTrailingEmptyPages, collapseUnderfilledPages } from "./paperStack";

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

function sized(text: string, height: number): HTMLElement {
  const el = doc.createElement("p");
  el.textContent = text;
  // jsdom doesn't lay out — override offsetHeight via getter so the
  // measureBlocksHeight helper sees deterministic sizes.
  Object.defineProperty(el, "offsetHeight", {
    configurable: true,
    get: () => height,
  });
  return el;
}

describe("collapseUnderfilledPages", () => {
  // Use a typical A4 content budget for tests.
  const BUDGET = 850;

  it("absorbs a tiny widow tail-page into the previous page", () => {
    // page 1: 800px content (fills most of the page).
    // page 2: 50px content (a widow line, ≤ 15% of 850).
    // Expected: 50px absorbed onto page 1; result has 1 page.
    const pages = [[sized("page1", 800)], [sized("widow", 50)]];
    const out = collapseUnderfilledPages(pages, BUDGET);
    expect(out).toHaveLength(1);
    expect(out[0]?.map((e) => e.textContent)).toEqual(["page1", "widow"]);
  });

  it("leaves a substantial second page alone", () => {
    // page 2 is 40% full — well above the widow threshold.
    const pages = [[sized("page1", 800)], [sized("page2", 350)]];
    const out = collapseUnderfilledPages(pages, BUDGET);
    expect(out).toHaveLength(2);
  });

  it("refuses to absorb when combined size would exceed budget + overflow tolerance", () => {
    // Overflow cap is budget + 20% (= 1020). 100px widow + 950 base
    // = 1050 > 1020 → refuse.
    const pages = [[sized("page1", 950)], [sized("widow", 100)]];
    const out = collapseUnderfilledPages(pages, BUDGET);
    expect(out).toHaveLength(2);
  });

  it("leaves a >15%-fill page alone (above widow threshold)", () => {
    // 200px ≈ 24% — too full to be considered a widow under the
    // (deliberately conservative) tight-only rule.
    const pages = [[sized("page1", 500)], [sized("midfill", 200)]];
    const out = collapseUnderfilledPages(pages, BUDGET);
    expect(out).toHaveLength(2);
  });

  it("absorbs middle widow into its previous page", () => {
    const pages = [
      [sized("page1", 500)],
      [sized("widow", 80)],
      [sized("page3", 600)],
    ];
    const out = collapseUnderfilledPages(pages, BUDGET);
    expect(out).toHaveLength(2);
    expect(out[0]?.map((e) => e.textContent)).toEqual(["page1", "widow"]);
    expect(out[1]?.map((e) => e.textContent)).toEqual(["page3"]);
  });

  it("handles two consecutive widows without cascading into one page", () => {
    // To prevent gigantic overflows we absorb at most one widow per
    // host page, then advance. With page4 above the widow threshold
    // (300 > 128), the second widow stays on its own page:
    //   [page1, w1]  → [page1+w1]   (host advances past w1)
    //   [w2,    p4]  → w2 is host, p4 is too big to qualify
    const pages = [
      [sized("page1", 400)],
      [sized("widow1", 50)],
      [sized("widow2", 60)],
      [sized("page4", 300)],
    ];
    const out = collapseUnderfilledPages(pages, BUDGET);
    expect(out).toHaveLength(3);
    expect(out[0]?.map((e) => e.textContent)).toEqual(["page1", "widow1"]);
    expect(out[1]?.map((e) => e.textContent)).toEqual(["widow2"]);
    expect(out[2]?.map((e) => e.textContent)).toEqual(["page4"]);
  });

  it("returns input unchanged when budgetPx is 0", () => {
    const pages = [[sized("a", 100)], [sized("b", 50)]];
    const out = collapseUnderfilledPages(pages, 0);
    expect(out).toHaveLength(2);
  });

  it("does not absorb a tight-widow page when even the aggressive cap would be exceeded", () => {
    // tight: widow 100 ≤ 128 ✓, but 1200+100=1300>1020.
    // aggressive: widow 100 ≤ 340 ✓, but 1200+100=1300>1275.
    // → refuses.
    const pages = [[sized("page1", 1200)], [sized("widow", 100)]];
    const out = collapseUnderfilledPages(pages, BUDGET);
    expect(out).toHaveLength(2);
  });
});
