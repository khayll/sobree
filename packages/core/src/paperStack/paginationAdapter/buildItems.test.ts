import { beforeAll, describe, expect, it } from "vitest";
import { buildItems } from "./buildItems";

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

/** Stub a layout height jsdom can't compute. */
function stubHeight(el: Element, px: number): void {
  Object.defineProperty(el, "offsetHeight", { value: px, configurable: true });
}

describe("buildItems: tall table row driven by a non-paragraph cell", () => {
  it("measures the row by its tallest cell, not its first — boxes sum to the true row height", () => {
    // Regression guard for the fedramp revision-history table: a row whose
    // height comes from a 9-item <ul> in one cell, next to a one-line date
    // cell. Both cells have a single block child, so the old
    // "dominant = most block children" tie picked the date cell and emitted
    // a ~20px box for a ~680px row — the engine under-measured it and the
    // table overflowed the page instead of breaking across pages.
    const els = elements(`
      <table><tbody><tr>
        <td><p>01/20/2017</p></td>
        <td><ul><li>a</li><li>b</li><li>c</li></ul></td>
      </tr></tbody></table>
    `);
    const tr = els[0]!.querySelector("tr")!;
    const dateP = tr.children[0]!.querySelector("p")!;
    const ul = tr.children[1]!.querySelector("ul")!;
    stubHeight(tr, 680); // taller than TALL_ROW_THRESHOLD → row-split path
    stubHeight(dateP, 20);
    stubHeight(ul, 657);

    const boxes = buildItems(els).filter(
      (it): it is Extract<typeof it, { type: "box" }> => it.type === "box" && it.height > 0,
    );
    const total = boxes.reduce((sum, b) => sum + b.height, 0);

    // Faithful: the row's boxes account for its full height (never the
    // 20px date cell), so the paginator can't under-measure and overflow.
    expect(total).toBeGreaterThanOrEqual(680);
    // The break unit is the list cell's content, not the date paragraph.
    expect(boxes.some((b) => b.el === ul)).toBe(true);
    expect(boxes.some((b) => b.el === dateP)).toBe(false);
  });
});

describe("buildItems: forced page breaks", () => {
  /** First BOX at or after `idx` — forced breaks put the inter-block glue
   *  BETWEEN the penalty and the element's box (the gap is charged to the
   *  new page, mirroring Word honouring space-before after a hard break). */
  const nextBox = (items: ReturnType<typeof buildItems>, idx: number) => {
    for (let i = idx; i < items.length; i++) {
      const it = items[i];
      if (it?.type === "box") return it;
      // Only glue may sit between a forced-break penalty and its box.
      expect(it?.type).toBe("glue");
    }
    return undefined;
  };

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

    // The marker element follows the penalty (after the inter-block
    // glue), monolithic, height 0.
    const idx = items.indexOf(penalty!);
    const marker = nextBox(items, idx + 1);
    expect(marker?.type).toBe("box");
    if (marker?.type === "box") {
      expect(marker.height).toBe(0);
      expect(marker.monolithic).toBe(true);
    }
  });

  it("`data-page-break-before` on a paragraph emits a Penalty before its glue + line boxes", () => {
    const els = elements(`
      <p>before</p>
      <p data-page-break-before>after</p>
    `);
    const items = buildItems(els);

    // The Penalty must precede the block's glue AND its box — the glue
    // lands AFTER the break so the new page is charged the space-before.
    const penaltyIdx = items.findIndex((it) => it.type === "penalty");
    expect(penaltyIdx).toBeGreaterThan(0);
    const glue = items[penaltyIdx + 1];
    expect(glue?.type).toBe("glue");
    const box = nextBox(items, penaltyIdx + 1);
    expect(box?.el).toBe(els[1]);
  });

  it("`data-page-break-before` on a heading emits a Penalty before the heading box", () => {
    const els = elements(`
      <p>before</p>
      <h2 data-page-break-before>after</h2>
    `);
    const items = buildItems(els);
    const penaltyIdx = items.findIndex((it) => it.type === "penalty");
    expect(penaltyIdx).toBeGreaterThan(0);
    const box = nextBox(items, penaltyIdx + 1);
    expect(box?.el).toBe(els[1]);
  });

  it("`data-page-break-before` on a table emits a Penalty before the first row box", () => {
    const els = elements(`
      <p>before</p>
      <table data-page-break-before><tr><td>cell</td></tr></table>
    `);
    const items = buildItems(els);
    const penaltyIdx = items.findIndex((it) => it.type === "penalty");
    expect(penaltyIdx).toBeGreaterThan(0);
    const box = nextBox(items, penaltyIdx + 1);
    expect(box?.type).toBe("box");
    if (box?.type === "box") {
      // After table-row pagination landed, tables emit one box per
      // TR (so the paginator can break between rows). The Penalty's
      // first follow-up box is the first row's; rows are monolithic —
      // we don't yet split a single row across pages.
      expect(box.el?.tagName).toBe("TR");
      expect(box.monolithic).toBe(true);
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
    const els = elements("<h1>title</h1><p>body</p>");
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
    table.innerHTML = "<table><tr><td>x</td></tr><tr><td>y</td></tr></table><pre>code</pre>";
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
