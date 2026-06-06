import { beforeEach, describe, expect, it } from "vitest";

import { applyPaginatedDoc } from "./apply";
import type { PaginatedDoc } from "./types";

const doc = window.document;

let host: HTMLElement;
beforeEach(() => {
  host = doc.createElement("div");
  doc.body.appendChild(host);
});

function place(...els: HTMLElement[]): HTMLElement[] {
  for (const el of els) host.appendChild(el);
  // Stamp measurement ids so applyPaginatedDoc can resolve segments.
  for (let i = 0; i < els.length; i++) els[i]!.dataset.measId = `m${i}`;
  return els;
}

function p(text = ""): HTMLElement {
  const el = doc.createElement("p");
  if (text) el.textContent = text;
  return el;
}

describe("applyPaginatedDoc — empty + trivial", () => {
  it("returns [] for an empty PaginatedDoc", () => {
    const out = applyPaginatedDoc(
      { pages: [], totalCost: 0, grewPageArray: false },
      [],
    );
    expect(out).toEqual([]);
  });

  it("returns blocks per page for a no-split partition", () => {
    const blocks = place(p("a"), p("b"), p("c"));
    const doc: PaginatedDoc = {
      pages: [
        { segments: [{ blockId: "m0" }, { blockId: "m1" }], usedHeight: 40 },
        { segments: [{ blockId: "m2" }], usedHeight: 20 },
      ],
      totalCost: 0,
      grewPageArray: false,
    };
    const out = applyPaginatedDoc(doc, blocks);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual([blocks[0], blocks[1]]);
    expect(out[1]).toEqual([blocks[2]]);
  });

  it("skips segments whose blockId can't be resolved", () => {
    const blocks = place(p("a"));
    const out = applyPaginatedDoc(
      {
        pages: [
          { segments: [{ blockId: "missing" }, { blockId: "m0" }], usedHeight: 20 },
        ],
        totalCost: 0,
        grewPageArray: false,
      },
      blocks,
    );
    expect(out).toEqual([[blocks[0]]]);
  });
});

describe("applyPaginatedDoc — list (<ol>/<ul>) distribution", () => {
  function makeList(tag: "ol" | "ul", count: number, start?: number): HTMLElement {
    const list = doc.createElement(tag);
    if (start !== undefined) list.setAttribute("start", String(start));
    for (let i = 0; i < count; i++) {
      const li = doc.createElement("li");
      li.textContent = `item ${i}`;
      list.appendChild(li);
    }
    return list;
  }

  it("a whole-list segment (no range) emits one per-page clone with all LIs", () => {
    const list = makeList("ul", 3);
    const blocks = place(list);
    const out = applyPaginatedDoc(
      {
        pages: [{ segments: [{ blockId: "m0" }], usedHeight: 60 }],
        totalCost: 0,
        grewPageArray: false,
      },
      blocks,
    );
    expect(out[0]).toHaveLength(1);
    expect(out[0]![0]!.tagName).toBe("UL");
    expect(out[0]![0]!.children).toHaveLength(3);
  });

  it("splits LIs into per-page UL clones at LI{N} segment boundaries", () => {
    const list = makeList("ul", 4);
    const lis = Array.from(list.children) as HTMLElement[];
    const blocks = place(list);
    const docPart: PaginatedDoc = {
      pages: [
        {
          segments: [
            { blockId: "m0", range: { startSegmentId: "LI0", endSegmentId: "LI1" } },
          ],
          usedHeight: 40,
        },
        {
          segments: [
            { blockId: "m0", range: { startSegmentId: "LI2", endSegmentId: "_END" } },
          ],
          usedHeight: 40,
        },
      ],
      totalCost: 0,
      grewPageArray: false,
    };
    const out = applyPaginatedDoc(docPart, blocks);
    expect(out).toHaveLength(2);
    // Page 0: clone UL with 2 LIs (LI0, LI1).
    expect(out[0]![0]!.tagName).toBe("UL");
    expect(out[0]![0]!.children).toHaveLength(2);
    expect(out[0]![0]!.children[0]).toBe(lis[0]);
    expect(out[0]![0]!.children[1]).toBe(lis[1]);
    // Page 1: clone UL with 2 LIs (LI2, LI3).
    expect(out[1]![0]!.tagName).toBe("UL");
    expect(out[1]![0]!.children).toHaveLength(2);
    expect(out[1]![0]!.children[0]).toBe(lis[2]);
    expect(out[1]![0]!.children[1]).toBe(lis[3]);
    // Source list is now empty and removed from host.
    expect(host.contains(list)).toBe(false);
  });

  it("ordered list per-page clone gets the right `start` attribute", () => {
    const list = makeList("ol", 4, 1);
    const blocks = place(list);
    const out = applyPaginatedDoc(
      {
        pages: [
          {
            segments: [
              { blockId: "m0", range: { startSegmentId: "LI0", endSegmentId: "LI1" } },
            ],
            usedHeight: 40,
          },
          {
            segments: [
              { blockId: "m0", range: { startSegmentId: "LI2", endSegmentId: "_END" } },
            ],
            usedHeight: 40,
          },
        ],
        totalCost: 0,
        grewPageArray: false,
      },
      blocks,
    );
    expect(out[0]![0]!.getAttribute("start")).toBe("1");
    // 3rd LI (index 2) → start = 1 + 2 = 3.
    expect(out[1]![0]!.getAttribute("start")).toBe("3");
  });

  it("respects a non-default source `start` attribute", () => {
    const list = makeList("ol", 3, 5);
    const blocks = place(list);
    const out = applyPaginatedDoc(
      {
        pages: [
          {
            segments: [
              { blockId: "m0", range: { startSegmentId: "LI0", endSegmentId: "LI0" } },
            ],
            usedHeight: 20,
          },
          {
            segments: [
              { blockId: "m0", range: { startSegmentId: "LI1", endSegmentId: "_END" } },
            ],
            usedHeight: 40,
          },
        ],
        totalCost: 0,
        grewPageArray: false,
      },
      blocks,
    );
    expect(out[0]![0]!.getAttribute("start")).toBe("5"); // 5+0
    expect(out[1]![0]!.getAttribute("start")).toBe("6"); // 5+1
  });
});

describe("applyPaginatedDoc — table distribution", () => {
  function makeTable(rowCount: number, withHead = false): HTMLElement {
    const table = doc.createElement("table");
    if (withHead) {
      const thead = doc.createElement("thead");
      const headTr = doc.createElement("tr");
      const th = doc.createElement("th");
      th.textContent = "Header";
      headTr.appendChild(th);
      thead.appendChild(headTr);
      table.appendChild(thead);
    }
    const tbody = doc.createElement("tbody");
    for (let i = 0; i < rowCount; i++) {
      const tr = doc.createElement("tr");
      const td = doc.createElement("td");
      td.textContent = `cell ${i}`;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }

  it("a whole-table segment (no range) emits one clone with all TRs", () => {
    const table = makeTable(3);
    const blocks = place(table);
    const out = applyPaginatedDoc(
      {
        pages: [{ segments: [{ blockId: "m0" }], usedHeight: 60 }],
        totalCost: 0,
        grewPageArray: false,
      },
      blocks,
    );
    expect(out[0]![0]!.tagName).toBe("TABLE");
    const tbody = out[0]![0]!.querySelector("tbody")!;
    expect(tbody.children).toHaveLength(3);
  });

  it("splits TRs into per-page table clones at R{N} segment boundaries", () => {
    const table = makeTable(4);
    const tbody = table.querySelector("tbody")!;
    const trs = Array.from(tbody.children) as HTMLElement[];
    const blocks = place(table);
    const out = applyPaginatedDoc(
      {
        pages: [
          {
            segments: [
              { blockId: "m0", range: { startSegmentId: "R0", endSegmentId: "R1" } },
            ],
            usedHeight: 40,
          },
          {
            segments: [
              { blockId: "m0", range: { startSegmentId: "R2", endSegmentId: "_END" } },
            ],
            usedHeight: 40,
          },
        ],
        totalCost: 0,
        grewPageArray: false,
      },
      blocks,
    );
    const page0Tbody = out[0]![0]!.querySelector("tbody")!;
    expect(page0Tbody.children[0]).toBe(trs[0]);
    expect(page0Tbody.children[1]).toBe(trs[1]);
    const page1Tbody = out[1]![0]!.querySelector("tbody")!;
    expect(page1Tbody.children[0]).toBe(trs[2]);
    expect(page1Tbody.children[1]).toBe(trs[3]);
    // Source table is now empty and removed from host.
    expect(host.contains(table)).toBe(false);
  });

  it("repeats THEAD on every per-page table clone", () => {
    const table = makeTable(2, true);
    const blocks = place(table);
    const out = applyPaginatedDoc(
      {
        pages: [
          {
            segments: [
              { blockId: "m0", range: { startSegmentId: "R0", endSegmentId: "R0" } },
            ],
            usedHeight: 20,
          },
          {
            segments: [
              { blockId: "m0", range: { startSegmentId: "R1", endSegmentId: "_END" } },
            ],
            usedHeight: 20,
          },
        ],
        totalCost: 0,
        grewPageArray: false,
      },
      blocks,
    );
    // Both per-page clones have a THEAD.
    expect(out[0]![0]!.querySelector("thead")).not.toBeNull();
    expect(out[1]![0]!.querySelector("thead")).not.toBeNull();
    // And both THEADs carry the original header text.
    expect(out[0]![0]!.querySelector("thead th")?.textContent).toBe("Header");
    expect(out[1]![0]!.querySelector("thead th")?.textContent).toBe("Header");
  });
});

describe("applyPaginatedDoc — paragraph character split", () => {
  // We can't drive Range.getClientRects in jsdom — its stub returns
  // empty rects. The applicator's paragraph-split path early-returns
  // when `metrics[localSplitLine].startCharOffset` is undefined or
  // 0, falling back to "no split". This is the documented degradation
  // mode for the jsdom env. We verify the path doesn't throw and that
  // the fragment map degrades to "single page = source element" so
  // both pages reference the same source on a 2-page split.
  it("paragraph with an L{N} split falls back gracefully under jsdom", () => {
    const para = p("hello world this is a long paragraph");
    const blocks = place(para);
    const out = applyPaginatedDoc(
      {
        pages: [
          {
            segments: [
              { blockId: "m0", range: { startSegmentId: "L0", endSegmentId: "L0" } },
            ],
            usedHeight: 10,
          },
          {
            segments: [
              { blockId: "m0", range: { startSegmentId: "L1", endSegmentId: "_END" } },
            ],
            usedHeight: 10,
          },
        ],
        totalCost: 0,
        grewPageArray: false,
      },
      blocks,
    );
    expect(out).toHaveLength(2);
    // Under jsdom (no layout), the split fails and both pages get the
    // source element — that's degraded behaviour, not correctness. The
    // contract: applicator doesn't throw on graceful degradation.
    // Real browser tests cover the actual split correctness.
    expect(out[0]).toHaveLength(1);
    expect(out[1]).toHaveLength(1);
  });
});
