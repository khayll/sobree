import { buildItems } from "./buildItems";
import { beforeAll, describe, expect, it } from "vitest";

// jsdom doesn't implement Range.getClientRects; the paragraph-line
// measurer falls back to a single-line metric when the rect list is
// empty, which is exactly what we want for these structure-level tests.
beforeAll(() => {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  }
});

/**
 * Build a fresh `<div>` with the given children attached, so each test
 * starts from a clean DOM. Children are detached from the document
 * after the test via the test runner's tear-down — no manual cleanup
 * needed for these one-shot fixtures.
 */
function elements(html: string): HTMLElement[] {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return Array.from(host.children) as HTMLElement[];
}

describe("buildItems: forced page breaks", () => {
  it("`data-page-break` element emits Penalty(-Infinity) + zero-height monolithic box", () => {
    const els = elements(`
      <p>before</p>
      <div data-page-break></div>
      <p>after</p>
    `);
    const items = buildItems(els);

    // Find the penalty item.
    const penalty = items.find((it) => it.type === "penalty");
    expect(penalty).toBeDefined();
    expect(penalty?.cost).toBe(Number.NEGATIVE_INFINITY);

    // The marker element follows the penalty, monolithic, height 0.
    const idx = items.indexOf(penalty!);
    const marker = items[idx + 1];
    expect(marker?.type).toBe("box");
    if (marker?.type === "box") {
      expect(marker.height).toBe(0);
      expect(marker.monolithic).toBe(true);
    }
  });

  it("`data-page-break-before` on a paragraph emits a Penalty before its line boxes", () => {
    const els = elements(`
      <p>before</p>
      <p data-page-break-before>after</p>
    `);
    const items = buildItems(els);

    // The Penalty must precede a Box whose `el` is the second paragraph.
    const penaltyIdx = items.findIndex((it) => it.type === "penalty");
    expect(penaltyIdx).toBeGreaterThan(0);
    const next = items[penaltyIdx + 1];
    expect(next?.type).toBe("box");
    if (next?.type === "box") {
      expect(next.el).toBe(els[1]);
    }
  });

  it("`data-page-break-before` on a heading emits a Penalty before the heading box", () => {
    const els = elements(`
      <p>before</p>
      <h2 data-page-break-before>after</h2>
    `);
    const items = buildItems(els);
    const penaltyIdx = items.findIndex((it) => it.type === "penalty");
    expect(penaltyIdx).toBeGreaterThan(0);
    const next = items[penaltyIdx + 1];
    expect(next?.type).toBe("box");
    if (next?.type === "box") {
      expect(next.el).toBe(els[1]);
    }
  });

  it("`data-page-break-before` on a table emits a Penalty before the first row box", () => {
    const els = elements(`
      <p>before</p>
      <table data-page-break-before><tr><td>cell</td></tr></table>
    `);
    const items = buildItems(els);
    const penaltyIdx = items.findIndex((it) => it.type === "penalty");
    expect(penaltyIdx).toBeGreaterThan(0);
    const next = items[penaltyIdx + 1];
    expect(next?.type).toBe("box");
    if (next?.type === "box") {
      // After table-row pagination landed, tables emit one box per
      // TR (so the paginator can break between rows). The Penalty's
      // immediate follow-up is the first row's box; rows are
      // monolithic — we don't yet split a single row across pages.
      expect(next.el?.tagName).toBe("TR");
      expect(next.monolithic).toBe(true);
    }
  });

  it("no `data-page-break-before` → no penalty for that block", () => {
    const els = elements(`
      <p>a</p>
      <p>b</p>
    `);
    const items = buildItems(els);
    expect(items.find((it) => it.type === "penalty")).toBeUndefined();
  });
});

describe("buildItems: keepWithNext + monolithic flags", () => {
  it("headings get `keepWithNext: true`", () => {
    const els = elements(`<h1>title</h1><p>body</p>`);
    const items = buildItems(els);
    const heading = items.find((it) => it.type === "box" && it.el === els[0]);
    expect(heading?.type).toBe("box");
    if (heading?.type === "box") {
      expect(heading.keepWithNext).toBe(true);
    }
  });

  it("table rows and <pre> are monolithic", () => {
    // Tables emit one box per TR (each row monolithic — we don't yet
    // split a single row across pages even when its cells contain
    // multi-line content). <pre> stays monolithic at the block level.
    const table = document.createElement("div");
    table.innerHTML = `<table><tr><td>x</td></tr><tr><td>y</td></tr></table><pre>code</pre>`;
    document.body.appendChild(table);
    const els = Array.from(table.children) as HTMLElement[];
    const items = buildItems(els);
    // Find every row inside the table.
    const rows = Array.from(els[0]!.querySelectorAll("tr"));
    expect(rows.length).toBe(2);
    for (const tr of rows) {
      const box = items.find((it) => it.type === "box" && it.el === tr);
      expect(box?.type).toBe("box");
      if (box?.type === "box") {
        expect(box.monolithic).toBe(true);
      }
    }
    // <pre> stays a single monolithic box pointing at itself.
    const preBox = items.find((it) => it.type === "box" && it.el === els[1]);
    expect(preBox?.type).toBe("box");
    if (preBox?.type === "box") expect(preBox.monolithic).toBe(true);
    table.remove();
  });
});
