import { beforeEach, describe, expect, it } from "vitest";

import { measureBlocks } from "./measure";

const doc = window.document;

let host: HTMLElement;

beforeEach(() => {
  host = doc.createElement("div");
  doc.body.appendChild(host);
});

/**
 * Helper: render a flat list of block elements into `host` and return
 * them. The measurement pass takes block elements as input, not the
 * host.
 */
function place(...els: HTMLElement[]): HTMLElement[] {
  for (const el of els) host.appendChild(el);
  return els;
}

function p(text = ""): HTMLElement {
  const el = doc.createElement("p");
  if (text) el.textContent = text;
  return el;
}

describe("measureBlocks — empty + trivial", () => {
  it("returns [] for an empty block list", () => {
    expect(measureBlocks([])).toEqual([]);
  });

  it("produces one measurement per block in input order", () => {
    const blocks = place(p("a"), p("b"), p("c"));
    const out = measureBlocks(blocks);
    expect(out).toHaveLength(3);
    expect(out.map((m) => m.blockId)).toEqual(["m0", "m1", "m2"]);
  });

  it("stamps data-meas-id when the renderer didn't provide one", () => {
    const blocks = place(p("a"));
    measureBlocks(blocks);
    expect(blocks[0]!.dataset.measId).toBe("m0");
  });

  it("preserves an existing data-meas-id (idempotent across re-runs)", () => {
    const el = p("a");
    el.dataset.measId = "custom-42";
    place(el);
    const out = measureBlocks([el]);
    expect(out[0]!.blockId).toBe("custom-42");
  });
});

describe("measureBlocks — gapBefore", () => {
  it("gapBefore is 0 for the first block", () => {
    const blocks = place(p("a"), p("b"));
    const out = measureBlocks(blocks);
    expect(out[0]!.gapBefore).toBe(0);
  });

  it("gapBefore for the second block reflects post-margin-collapse distance", () => {
    // In jsdom layout is mostly noop — offsetTop is 0 for both unless
    // we mock it. Verify the FUNCTION reads offsetTop - prevBottom; we
    // can't drive real layout, so the contract here is "gapBefore is a
    // non-negative number that uses offsetTop".
    const a = p("a");
    const b = p("b");
    Object.defineProperty(a, "offsetTop", { value: 0, configurable: true });
    Object.defineProperty(a, "offsetHeight", { value: 20, configurable: true });
    Object.defineProperty(b, "offsetTop", { value: 28, configurable: true }); // 8px gap
    Object.defineProperty(b, "offsetHeight", { value: 20, configurable: true });
    place(a, b);
    const out = measureBlocks([a, b]);
    expect(out[1]!.gapBefore).toBe(8);
  });

  it("clamps a negative gap (out-of-order layout) to 0", () => {
    const a = p("a");
    const b = p("b");
    Object.defineProperty(a, "offsetTop", { value: 100, configurable: true });
    Object.defineProperty(a, "offsetHeight", { value: 20, configurable: true });
    Object.defineProperty(b, "offsetTop", { value: 0, configurable: true });
    Object.defineProperty(b, "offsetHeight", { value: 20, configurable: true });
    place(a, b);
    const out = measureBlocks([a, b]);
    expect(out[1]!.gapBefore).toBe(0);
  });
});

describe("measureBlocks — page break + keep flags", () => {
  it("reads data-page-break-before into pageBreakBefore: true", () => {
    const el = p("a");
    el.setAttribute("data-page-break-before", "");
    place(el);
    const out = measureBlocks([el]);
    expect(out[0]!.pageBreakBefore).toBe(true);
  });

  it("treats the .page-break / [data-page-break] marker as pageBreakBefore", () => {
    const el = doc.createElement("div");
    el.className = "page-break";
    place(el);
    const out = measureBlocks([el]);
    expect(out[0]!.pageBreakBefore).toBe(true);
  });

  it("omits pageBreakBefore when not set", () => {
    const el = p("a");
    place(el);
    const out = measureBlocks([el]);
    expect(out[0]!.pageBreakBefore).toBeUndefined();
  });

  it("reads data-keep-next as keepWithNext: true", () => {
    const el = p("a");
    el.setAttribute("data-keep-next", "");
    place(el);
    const out = measureBlocks([el]);
    expect(out[0]!.keepWithNext).toBe(true);
  });

  it("treats h1-h6 as keepWithNext: true (implicit heading semantics)", () => {
    for (const tag of ["H1", "H2", "H3", "H4", "H5", "H6"] as const) {
      const el = doc.createElement(tag);
      el.textContent = "Heading";
      const blocks = place(el);
      const out = measureBlocks(blocks);
      expect(out[0]!.keepWithNext).toBe(true);
      // Reset host for next iteration.
      host.innerHTML = "";
    }
  });

  it("treats <figure>, .keep-together, [data-keep-together], <pre> as keepTogether", () => {
    const fig = doc.createElement("figure");
    const kt = doc.createElement("div");
    kt.className = "keep-together";
    const dkt = doc.createElement("div");
    dkt.setAttribute("data-keep-together", "");
    const pre = doc.createElement("pre");
    place(fig, kt, dkt, pre);
    const out = measureBlocks([fig, kt, dkt, pre]);
    expect(out.map((m) => m.keepTogether)).toEqual([true, true, true, true]);
  });
});

describe("measureBlocks — out-of-flow blocks", () => {
  it("zeros the height of position: absolute blocks (don't compete for budget)", () => {
    const el = p("anchored");
    el.style.position = "absolute";
    Object.defineProperty(el, "offsetHeight", { value: 200, configurable: true });
    place(el);
    const out = measureBlocks([el]);
    expect(out[0]!.outOfFlow).toBe(true);
    expect(out[0]!.height).toBe(0);
  });

  it("doesn't move prevBottom past an out-of-flow block", () => {
    const a = p("a");
    Object.defineProperty(a, "offsetTop", { value: 0, configurable: true });
    Object.defineProperty(a, "offsetHeight", { value: 20, configurable: true });
    const floater = p("floater");
    floater.style.position = "absolute";
    Object.defineProperty(floater, "offsetTop", { value: 100, configurable: true });
    Object.defineProperty(floater, "offsetHeight", { value: 50, configurable: true });
    const c = p("c");
    Object.defineProperty(c, "offsetTop", { value: 30, configurable: true });
    Object.defineProperty(c, "offsetHeight", { value: 20, configurable: true });
    place(a, floater, c);
    const out = measureBlocks([a, floater, c]);
    // c.offsetTop=30, prevBottom (= a.offsetTop+offsetHeight = 20) → gap=10.
    // If the floater had moved prevBottom, the gap would have been 30-150=-120 → 0.
    expect(out[2]!.gapBefore).toBe(10);
  });
});

describe("measureBlocks — split points for <ol>/<ul>", () => {
  it("emits a split point per non-final <li>", () => {
    const ul = doc.createElement("ul");
    Object.defineProperty(ul, "offsetTop", { value: 0, configurable: true });
    const lis = [0, 1, 2].map((i) => {
      const li = doc.createElement("li");
      li.textContent = `li ${i}`;
      Object.defineProperty(li, "offsetTop", { value: i * 30, configurable: true });
      Object.defineProperty(li, "offsetHeight", { value: 20, configurable: true });
      ul.appendChild(li);
      return li;
    });
    void lis;
    place(ul);
    const out = measureBlocks([ul]);
    // 3 LIs → 2 split points (after li 0, after li 1)
    expect(out[0]!.splitPoints).toHaveLength(2);
    expect(out[0]!.splitPoints![0]).toEqual({ yOffset: 20, segmentId: "LI0" });
    expect(out[0]!.splitPoints![1]).toEqual({ yOffset: 50, segmentId: "LI1" });
  });

  it("returns undefined splitPoints for a single-LI list (nothing to split)", () => {
    const ul = doc.createElement("ul");
    const li = doc.createElement("li");
    ul.appendChild(li);
    place(ul);
    const out = measureBlocks([ul]);
    expect(out[0]!.splitPoints).toBeUndefined();
  });

  it("returns undefined splitPoints for an empty list", () => {
    const ul = doc.createElement("ul");
    place(ul);
    const out = measureBlocks([ul]);
    expect(out[0]!.splitPoints).toBeUndefined();
  });
});

describe("measureBlocks — split points for <table>", () => {
  it("emits a split point per non-final <tr> (THEAD then TBODY)", () => {
    const table = doc.createElement("table");
    Object.defineProperty(table, "offsetTop", { value: 0, configurable: true });
    const thead = doc.createElement("thead");
    const headTr = doc.createElement("tr");
    Object.defineProperty(headTr, "offsetTop", { value: 0, configurable: true });
    Object.defineProperty(headTr, "offsetHeight", { value: 20, configurable: true });
    thead.appendChild(headTr);
    const tbody = doc.createElement("tbody");
    const trs = [1, 2].map((i) => {
      const tr = doc.createElement("tr");
      Object.defineProperty(tr, "offsetTop", { value: i * 30, configurable: true });
      Object.defineProperty(tr, "offsetHeight", { value: 25, configurable: true });
      tbody.appendChild(tr);
      return tr;
    });
    void trs;
    table.append(thead, tbody);
    place(table);
    const out = measureBlocks([table]);
    // 3 TRs (1 thead + 2 tbody) → 2 split points
    expect(out[0]!.splitPoints).toHaveLength(2);
    expect(out[0]!.splitPoints![0]!.segmentId).toBe("R0");
    expect(out[0]!.splitPoints![1]!.segmentId).toBe("R1");
  });

  it("falls back to direct <tr> children when no THEAD/TBODY", () => {
    const table = doc.createElement("table");
    const trs = [0, 1].map((i) => {
      const tr = doc.createElement("tr");
      Object.defineProperty(tr, "offsetTop", { value: i * 30, configurable: true });
      Object.defineProperty(tr, "offsetHeight", { value: 20, configurable: true });
      table.appendChild(tr);
      return tr;
    });
    void trs;
    place(table);
    const out = measureBlocks([table]);
    expect(out[0]!.splitPoints).toHaveLength(1);
  });

  it("monolithic tables (no/one TR) have no split points", () => {
    const table = doc.createElement("table");
    place(table);
    const out = measureBlocks([table]);
    expect(out[0]!.splitPoints).toBeUndefined();
  });
});

describe("measureBlocks — figure / keep-together are monolithic (no splitPoints)", () => {
  it("does NOT emit split points for <figure> even if it has many children", () => {
    const fig = doc.createElement("figure");
    fig.append(p("a"), p("b"), p("c"));
    place(fig);
    const out = measureBlocks([fig]);
    expect(out[0]!.splitPoints).toBeUndefined();
    expect(out[0]!.keepTogether).toBe(true);
  });

  it("does NOT emit split points for <pre>", () => {
    const pre = doc.createElement("pre");
    pre.textContent = "line1\nline2\nline3";
    place(pre);
    const out = measureBlocks([pre]);
    expect(out[0]!.splitPoints).toBeUndefined();
    expect(out[0]!.keepTogether).toBe(true);
  });
});
