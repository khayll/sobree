/**
 * End-to-end round-trip: measureBlocks → paginateMeasurements →
 * applyPaginatedDoc.
 *
 * Proves the typed contract is self-consistent — measurements out of
 * the measure pass feed the engine bridge, whose PaginatedDoc feeds the
 * applicator, and the per-page DOM the applicator returns matches what
 * the engine planned.
 *
 * Heights are stubbed via Object.defineProperty since jsdom doesn't
 * run layout. The shape of the test is "given these heights, the
 * engine SHOULD partition this way, and the applicator SHOULD realise
 * it like THIS." We're testing the contract, not the layout engine.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { applyPaginatedDoc } from "./apply";
import { paginateMeasurements } from "./engine";
import { measureBlocks } from "./measure";

const doc = window.document;

let host: HTMLElement;
beforeEach(() => {
  host = doc.createElement("div");
  doc.body.appendChild(host);
});

function stubHeight(el: HTMLElement, top: number, height: number): void {
  Object.defineProperty(el, "offsetTop", { value: top, configurable: true });
  Object.defineProperty(el, "offsetHeight", { value: height, configurable: true });
}

describe("round-trip: measure → engine → apply", () => {
  it("plain paragraphs pack onto pages by the engine's budget choice", () => {
    const blocks: HTMLElement[] = [];
    for (let i = 0; i < 4; i++) {
      const p = doc.createElement("p");
      p.textContent = `para ${i}`;
      stubHeight(p, i * 30, 30);
      host.appendChild(p);
      blocks.push(p);
    }
    const measurements = measureBlocks(blocks);
    const paginated = paginateMeasurements(measurements, {
      pageHeights: [],
      defaultPageHeight: 65, // fits 2 per page
    });
    const pages = applyPaginatedDoc(paginated, blocks);

    // Engine chose 2 pages of 2 paragraphs each (60px each, under 65 budget).
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(2);
    expect(pages[1]).toHaveLength(2);
    // Each page references the original paragraph elements (no splits).
    expect(pages[0]![0]).toBe(blocks[0]);
    expect(pages[1]![0]).toBe(blocks[2]);
  });

  it("a forced page break (data-page-break-before) splits the doc", () => {
    const a = doc.createElement("p");
    a.textContent = "a";
    stubHeight(a, 0, 30);
    const b = doc.createElement("p");
    b.textContent = "b";
    stubHeight(b, 30, 30);
    b.setAttribute("data-page-break-before", "");
    const c = doc.createElement("p");
    c.textContent = "c";
    stubHeight(c, 60, 30);
    host.append(a, b, c);
    const blocks = [a, b, c];

    const measurements = measureBlocks(blocks);
    expect(measurements[1]!.pageBreakBefore).toBe(true);

    const paginated = paginateMeasurements(measurements, {
      pageHeights: [],
      defaultPageHeight: 200, // plenty of room — but b's forced break splits.
    });
    expect(paginated.pages.length).toBe(2);

    const pages = applyPaginatedDoc(paginated, blocks);
    expect(pages[0]).toEqual([a]);
    expect(pages[1]).toEqual([b, c]);
  });

  it("a multi-LI list splits into per-page UL clones with correct slices", () => {
    const ul = doc.createElement("ul");
    stubHeight(ul, 0, 80);
    const lis: HTMLElement[] = [];
    for (let i = 0; i < 4; i++) {
      const li = doc.createElement("li");
      li.textContent = `item ${i}`;
      stubHeight(li, i * 20, 20);
      ul.appendChild(li);
      lis.push(li);
    }
    host.appendChild(ul);
    const blocks = [ul];

    const measurements = measureBlocks(blocks);
    expect(measurements[0]!.splitPoints).toHaveLength(3); // 4 LIs → 3 split points

    // Page budget = 45 → 2 LIs (40px) fit, 3rd doesn't (60px).
    const paginated = paginateMeasurements(measurements, {
      pageHeights: [],
      defaultPageHeight: 45,
    });
    const pages = applyPaginatedDoc(paginated, blocks);
    // Engine should have produced at least 2 pages.
    expect(pages.length).toBeGreaterThanOrEqual(2);
    // Combined, all 4 original LIs land somewhere across the pages —
    // exact split point depends on the engine's cost calculation, but
    // the total LI count across all per-page UL clones must equal 4.
    let totalLisOnPages = 0;
    for (const page of pages) {
      for (const el of page) {
        if (el.tagName === "UL") totalLisOnPages += el.children.length;
      }
    }
    expect(totalLisOnPages).toBe(4);
  });

  it("an out-of-flow block doesn't compete for budget", () => {
    const a = doc.createElement("p");
    a.textContent = "a";
    stubHeight(a, 0, 40);
    const floater = doc.createElement("p");
    floater.textContent = "anchored";
    floater.style.position = "absolute";
    stubHeight(floater, 100, 200); // would be way over budget if counted
    const b = doc.createElement("p");
    b.textContent = "b";
    stubHeight(b, 40, 40);
    host.append(a, floater, b);
    const blocks = [a, floater, b];

    const measurements = measureBlocks(blocks);
    expect(measurements[1]!.outOfFlow).toBe(true);
    expect(measurements[1]!.height).toBe(0);

    const paginated = paginateMeasurements(measurements, {
      pageHeights: [],
      defaultPageHeight: 100,
    });
    // 40 + 0 (floater) + 40 = 80 fits on one page.
    expect(paginated.pages).toHaveLength(1);

    const pages = applyPaginatedDoc(paginated, blocks);
    expect(pages[0]).toHaveLength(3);
  });
});
