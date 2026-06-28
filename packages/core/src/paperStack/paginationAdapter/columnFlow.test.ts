import { afterEach, describe, expect, it } from "vitest";
import { flowColumnSections } from "./columnFlow";

/** A `.sobree-col`'s height is the sum of its children's stubbed heights;
 *  jsdom can't lay out, so model it on the prototype for the duration of
 *  a test (paragraphs carry their own stubbed `offsetHeight`). Everything
 *  else (wrappers) reports 0, and `getBoundingClientRect` is jsdom's all-
 *  zero default — so a section's first chunk always gets the full page
 *  budget here (no preceding-content offset to subtract). */
function installColHeightModel(): void {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.classList.contains("sobree-col")) return 0;
      return Array.from(this.children).reduce((s, c) => s + (c as HTMLElement).offsetHeight, 0);
    },
  });
}

function stub(el: Element, px: number): void {
  Object.defineProperty(el, "offsetHeight", { value: px, configurable: true });
}

function blocks(root: HTMLElement, wrapper: HTMLElement, blockPx: number[]): void {
  blockPx.forEach((h, i) => {
    const p = document.createElement("p");
    p.textContent = `b${i}`;
    stub(p, h);
    wrapper.appendChild(p);
  });
  root.appendChild(wrapper);
}

/** A root with one UNEQUAL-column wrapper. */
function unequalRoot(widthsMm: string, gapsMm: string, blockPx: number[]): HTMLElement {
  const root = document.createElement("div");
  const w = document.createElement("div");
  w.className = "sobree-cols sobree-cols-unequal";
  w.dataset.pagCid = "cols-0";
  w.dataset.colCount = String(widthsMm.split(",").length);
  w.dataset.colWidthsMm = widthsMm;
  w.dataset.colGapsMm = gapsMm;
  blocks(root, w, blockPx);
  return root;
}

/** A root with one EQUAL-column wrapper. */
function equalRoot(count: number, gapMm: string, blockPx: number[]): HTMLElement {
  const root = document.createElement("div");
  const w = document.createElement("div");
  w.className = "sobree-cols sobree-section-cols";
  w.dataset.pagCid = "cols-0";
  w.dataset.colCount = String(count);
  w.dataset.colGapMm = gapMm;
  blocks(root, w, blockPx);
  return root;
}

const cols = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(".sobree-col"));
const wrappers = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(".sobree-cols"));
const order = (root: HTMLElement) =>
  cols(root)
    .flatMap((c) => Array.from(c.children))
    .map((b) => b.textContent);

afterEach(() => {
  delete (HTMLElement.prototype as { offsetHeight?: unknown }).offsetHeight;
});

describe("flowColumnSections — unequal widths, single page", () => {
  it("builds explicit-width tracks and balances blocks across them", () => {
    installColHeightModel();
    // 6 blocks × 100px → balanced 3/3 (each column 300px).
    const root = unequalRoot("116,52", "13", Array(6).fill(100));
    flowColumnSections(root, 1000);

    const c = cols(root);
    expect(c.length).toBe(2);
    expect(c[0]!.style.width).toBe("116mm");
    expect(c[1]!.style.width).toBe("52mm");
    expect(c[0]!.childElementCount).toBe(3);
    expect(c[1]!.childElementCount).toBe(3);
    expect(c[0]!.children[0]!.textContent).toBe("b0");
    expect(c[1]!.children[0]!.textContent).toBe("b3");
  });

  it("balances even when all content fits under the page budget", () => {
    // A section shorter than one page must still split across columns
    // (Word balances), not dump everything in track 0. 4×100, budget
    // 1000 → 2/2, not 4/0.
    installColHeightModel();
    const root = unequalRoot("116,52", "13", Array(4).fill(100));
    flowColumnSections(root, 1000);
    const c = cols(root);
    expect(c[0]!.childElementCount).toBe(2);
    expect(c[1]!.childElementCount).toBe(2);
  });

  it("ignores wrappers with fewer than two columns", () => {
    const root = document.createElement("div");
    const w = document.createElement("div");
    w.className = "sobree-cols";
    w.dataset.colCount = "1";
    blocks(root, w, [50, 50]);
    flowColumnSections(root, 100);
    expect(cols(root).length).toBe(0);
    expect(w.childElementCount).toBe(2); // untouched
  });
});

describe("flowColumnSections — equal widths", () => {
  it("builds flex tracks (no explicit width) and balances", () => {
    installColHeightModel();
    const root = equalRoot(2, "5", Array(6).fill(100));
    flowColumnSections(root, 1000);
    const c = cols(root);
    expect(c.length).toBe(2);
    expect(c[0]!.style.flex).toBe("1 1 0px"); // jsdom serialises the 0 basis with a unit
    expect(c[0]!.style.width).toBe(""); // sized by flexbox, not inline width
    expect(c[0]!.style.marginRight).toBe("5mm"); // inter-column gap on all but last
    expect(c[1]!.style.marginRight).toBe("");
    expect(c[0]!.childElementCount).toBe(3);
    expect(c[1]!.childElementCount).toBe(3);
  });
});

describe("flowColumnSections — fill vs balance (data-col-fill)", () => {
  it("FILLS column 0 to the page bottom, then column 1, when fill-first", () => {
    // Same 4 blocks under the budget that balance 2/2 above — but a
    // fill-first section (ended by a hard page break in Word) packs column 0
    // first: 4/0, not balanced.
    installColHeightModel();
    const root = equalRoot(2, "5", Array(4).fill(100));
    wrappers(root)[0]!.dataset.colFill = "1";
    flowColumnSections(root, 1000);
    const c = cols(root);
    expect(c[0]!.childElementCount).toBe(4);
    expect(c[1]!.childElementCount).toBe(0);
  });

  it("fill-first still respects the page budget (col0 to budget, col1 rest)", () => {
    installColHeightModel();
    // 12×100; budget 700 → col0 packs 7 (700), col1 takes the other 5. A
    // balanced section would split 6/6 — so the 7/5 split proves fill-first.
    const root = equalRoot(2, "5", Array(12).fill(100));
    wrappers(root)[0]!.dataset.colFill = "1";
    flowColumnSections(root, 700);
    const c = cols(root);
    expect(wrappers(root).length).toBe(1); // one page, no spurious chunk
    expect(c[0]!.childElementCount).toBe(7);
    expect(c[1]!.childElementCount).toBe(5);
  });
});

describe("flowColumnSections — separator rule (data-col-sep)", () => {
  it("draws a centred rule between columns and splits the gap", () => {
    installColHeightModel();
    const root = equalRoot(2, "10", Array(4).fill(100));
    wrappers(root)[0]!.dataset.colSep = "1";
    flowColumnSections(root, 1000);
    const c = cols(root);
    expect(c[0]!.style.borderRight).toContain("solid"); // rule on the non-last track
    expect(c[1]!.style.borderRight).toBe(""); // none after the last
    expect(c[0]!.style.marginRight).toBe("5mm"); // half the 10mm gap
    expect(c[1]!.style.marginLeft).toBe("5mm"); // the other half
  });

  it("leaves a full right-margin gap and no rule without the flag", () => {
    installColHeightModel();
    const root = equalRoot(2, "10", Array(4).fill(100));
    flowColumnSections(root, 1000);
    const c = cols(root);
    expect(c[0]!.style.borderRight).toBe("");
    expect(c[0]!.style.marginRight).toBe("10mm");
    expect(c[1]!.style.marginLeft).toBe("");
  });
});

describe("flowColumnSections — snaking across pages", () => {
  it("splits a section taller than one page into per-page wrappers", () => {
    installColHeightModel();
    // 6×100px, page budget 250px. Page 1 fills col0 (b0,b1=200; b2 would
    // breach 250) then col1 (b2,b3); page 2 holds the remainder (b4,b5),
    // balanced as the final page.
    const root = unequalRoot("116,52", "13", Array(6).fill(100));
    flowColumnSections(root, 250);

    expect(wrappers(root).length).toBe(2); // two page-chunks
    expect(cols(root).length).toBe(4); // 2 columns × 2 pages
    // Document order is preserved across columns AND pages.
    expect(order(root)).toEqual(["b0", "b1", "b2", "b3", "b4", "b5"]);
    // Interior page is filled (col0 packed to budget); final page balanced.
    const [page1, page2] = wrappers(root);
    const p1cols = Array.from(page1!.querySelectorAll<HTMLElement>(".sobree-col"));
    expect(p1cols[0]!.offsetHeight).toBeLessThanOrEqual(250);
    expect(p1cols[0]!.childElementCount).toBe(2);
    const p2cols = Array.from(page2!.querySelectorAll<HTMLElement>(".sobree-col"));
    expect(p2cols[0]!.childElementCount).toBe(1); // balanced 1/1
    expect(p2cols[1]!.childElementCount).toBe(1);
  });

  it("never strands content even when a single block exceeds the budget", () => {
    installColHeightModel();
    // One 400px block under a 250px budget: it must still be placed (the
    // first track of a page is forced), not dropped or looped forever.
    const root = unequalRoot("100,100", "0", [400, 80, 80]);
    flowColumnSections(root, 250);
    expect(order(root)).toEqual(["b0", "b1", "b2"]);
  });
});

describe("flowColumnSections — idempotence", () => {
  it("re-consolidates per-page wrappers and reproduces the same layout", () => {
    installColHeightModel();
    const root = unequalRoot("116,52", "13", Array(6).fill(100));
    flowColumnSections(root, 250);
    const firstOrder = order(root);
    const firstWrapperCount = wrappers(root).length;

    flowColumnSections(root, 250); // second pass on the already-split DOM
    expect(wrappers(root).length).toBe(firstWrapperCount); // not doubled
    expect(order(root)).toEqual(firstOrder);
  });

  it("re-flattens a single-page section on re-run (no nested tracks)", () => {
    installColHeightModel();
    const root = unequalRoot("100,100", "10", Array(4).fill(100));
    flowColumnSections(root, 1000);
    flowColumnSections(root, 1000);
    const c = cols(root);
    expect(c.length).toBe(2);
    expect(c[0]!.childElementCount).toBe(2);
    expect(c[1]!.childElementCount).toBe(2);
  });
});
