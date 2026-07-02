import { beforeEach, describe, expect, it } from "vitest";

import type { SectionProperties } from "../../../doc/types";
import {
  collapseSectionTrailerEmpty,
  columnsFillNotBalance,
  evictTrailingEmptyParagraphs,
  openColumnContainerIfNeeded,
  sectionStartsOnFreshPage,
} from "./sectionFlow";

const doc = window.document;

function section(over: Partial<SectionProperties> = {}): SectionProperties {
  return {
    pageSize: { wTwips: 11906, hTwips: 16838, orientation: "portrait" },
    pageMargins: {
      topTwips: 1440,
      rightTwips: 1440,
      bottomTwips: 1440,
      leftTwips: 1440,
      headerTwips: 720,
      footerTwips: 720,
      gutterTwips: 0,
    },
    headerRefs: [],
    footerRefs: [],
    ...over,
  };
}

function p(text = ""): HTMLElement {
  const el = doc.createElement("p");
  if (text) el.textContent = text;
  return el;
}

let host: HTMLElement;
beforeEach(() => {
  host = doc.createElement("div");
});

describe("openColumnContainerIfNeeded", () => {
  it("returns the host unchanged for single-column sections", () => {
    expect(openColumnContainerIfNeeded(host, undefined)).toBe(host);
    expect(openColumnContainerIfNeeded(host, section({ columns: { count: 1 } }))).toBe(host);
    expect(host.children).toHaveLength(0);
  });

  it("creates an equal-column container stamped with count + gap + section id", () => {
    const wrapper = openColumnContainerIfNeeded(
      host,
      section({ columns: { count: 2, spaceTwips: 720 } }),
      3,
    );
    expect(wrapper).not.toBe(host);
    // Shared `.sobree-cols` (flow pass selector) + the equal variant.
    expect(wrapper.className).toBe("sobree-cols sobree-section-cols");
    expect(wrapper.dataset.colCount).toBe("2");
    expect(wrapper.dataset.pagCid).toBe("cols-3");
    // 720 twips = 12.7mm exact; the flow pass sizes equal tracks itself.
    expect(wrapper.dataset.colGapMm).toBe("12.7");
    expect(wrapper.dataset.colWidthsMm).toBeUndefined();
    expect(host.firstElementChild).toBe(wrapper);
  });

  it("creates an unequal-column container with explicit widths + gaps", () => {
    const wrapper = openColumnContainerIfNeeded(
      host,
      section({
        columns: {
          count: 2,
          equalWidth: false,
          columns: [{ widthTwips: 6576, spaceTwips: 720 }, { widthTwips: 2928 }],
        },
      }),
      1,
    );
    expect(wrapper.className).toBe("sobree-cols sobree-cols-unequal");
    expect(wrapper.dataset.colCount).toBe("2");
    expect(wrapper.dataset.pagCid).toBe("cols-1");
    // 6576 twips = 115.993mm, 2928 = 51.647mm (sub-twip exact)
    expect(wrapper.dataset.colWidthsMm).toBe("115.993,51.647");
    expect(wrapper.dataset.colGapsMm).toBe("12.7"); // one gap (n-1)
  });

  it("stamps data-col-fill when the section ends at a hard page break", () => {
    // Next section starts with `nextPage` ⇒ this column section is fill-first.
    const fill = openColumnContainerIfNeeded(
      host,
      section({ columns: { count: 2 } }),
      1,
      section({ type: "nextPage" }),
    );
    expect(fill.dataset.colFill).toBe("1");

    // Next section is `continuous` ⇒ balance (no flag).
    const balanced = openColumnContainerIfNeeded(
      doc.createElement("div"),
      section({ columns: { count: 2 } }),
      1,
      section({ type: "continuous" }),
    );
    expect(balanced.dataset.colFill).toBeUndefined();
  });

  it("stamps data-col-page-start when the section itself begins on a fresh page", () => {
    const fresh = openColumnContainerIfNeeded(
      host,
      section({ columns: { count: 2 }, type: "nextPage" }),
      1,
    );
    expect(fresh.dataset.colPageStart).toBe("1");

    const continued = openColumnContainerIfNeeded(
      doc.createElement("div"),
      section({ columns: { count: 2 }, type: "continuous" }),
      1,
    );
    expect(continued.dataset.colPageStart).toBeUndefined();
  });

  it("stamps data-col-sep from the separator flag", () => {
    const sep = openColumnContainerIfNeeded(
      host,
      section({ columns: { count: 2, separator: true } }),
      0,
    );
    expect(sep.dataset.colSep).toBe("1");
    const plain = openColumnContainerIfNeeded(
      doc.createElement("div"),
      section({ columns: { count: 2 } }),
      0,
    );
    expect(plain.dataset.colSep).toBeUndefined();
  });

  it("noColumnBalance forces fill-first even with a continuous next section", () => {
    const w = openColumnContainerIfNeeded(
      host,
      section({ columns: { count: 2 } }),
      1,
      section({ type: "continuous" }),
      true,
    );
    expect(w.dataset.colFill).toBe("1");
  });
});

describe("column balance / fresh-page policy", () => {
  it("columnsFillNotBalance — fill on a hard break, balance on continuous / doc end", () => {
    expect(columnsFillNotBalance(section({ type: "nextPage" }))).toBe(true);
    expect(columnsFillNotBalance(section({ type: "evenPage" }))).toBe(true);
    expect(columnsFillNotBalance(section({ type: "oddPage" }))).toBe(true);
    expect(columnsFillNotBalance(section({ type: "continuous" }))).toBe(false);
    expect(columnsFillNotBalance(undefined)).toBe(false); // last section ⇒ balance
  });

  it("sectionStartsOnFreshPage — true only for hard page-break starts", () => {
    expect(sectionStartsOnFreshPage(section({ type: "nextPage" }))).toBe(true);
    expect(sectionStartsOnFreshPage(section({ type: "evenPage" }))).toBe(true);
    expect(sectionStartsOnFreshPage(section({ type: "continuous" }))).toBe(false);
    expect(sectionStartsOnFreshPage(section({}))).toBe(false);
    expect(sectionStartsOnFreshPage(undefined)).toBe(false);
  });
});

describe("evictTrailingEmptyParagraphs", () => {
  it("moves trailing empty <p>s from a columns container back to host", () => {
    const cols = openColumnContainerIfNeeded(host, section({ columns: { count: 2 } }));
    cols.append(p("Real"), p(""), p(""));
    evictTrailingEmptyParagraphs(cols, host);
    expect(cols.children).toHaveLength(1);
    expect(host.children).toHaveLength(3); // cols + 2 evicted empties
    expect(host.lastElementChild?.tagName).toBe("P");
  });

  it("preserves document order of evicted empties (boundary empty ends up last)", () => {
    const cols = openColumnContainerIfNeeded(host, section({ columns: { count: 2 } }));
    const first = p("");
    const boundary = p("");
    first.dataset.k = "first";
    boundary.dataset.k = "boundary";
    cols.append(p("Real"), first, boundary);
    evictTrailingEmptyParagraphs(cols, host);
    // host: [cols, first, boundary] — boundary (the doc-order-last empty,
    // i.e. the section-boundary paragraph) must be the LAST child so the
    // section break appended next sits right after it.
    const evicted = [...host.children].slice(1) as HTMLElement[];
    expect(evicted.map((e) => e.dataset.k)).toEqual(["first", "boundary"]);
  });

  it("stops at the first non-empty paragraph", () => {
    const cols = openColumnContainerIfNeeded(host, section({ columns: { count: 2 } }));
    cols.append(p(""), p("Real"), p(""));
    evictTrailingEmptyParagraphs(cols, host);
    expect(cols.children).toHaveLength(2); // empty + "Real" remain
    expect(host.children).toHaveLength(2); // cols + 1 evicted empty
  });

  it("is a no-op when container isn't a columns container", () => {
    host.append(p("a"), p(""));
    evictTrailingEmptyParagraphs(host, host);
    expect(host.children).toHaveLength(2);
  });

  it("treats <p> with embedded image as non-empty (won't evict)", () => {
    const cols = openColumnContainerIfNeeded(host, section({ columns: { count: 2 } }));
    const withImg = p();
    withImg.appendChild(doc.createElement("img"));
    cols.append(p("a"), withImg);
    evictTrailingEmptyParagraphs(cols, host);
    expect(cols.children).toHaveLength(2);
  });
});

describe("collapseSectionTrailerEmpty", () => {
  function sectBreak(): HTMLElement {
    const el = doc.createElement("div");
    el.className = "sobree-section-break";
    return el;
  }

  it("marks the empty <p> immediately before the section break", () => {
    host.append(p("body"), p(""), sectBreak());
    collapseSectionTrailerEmpty(host);
    const empty = host.children[1] as HTMLElement;
    expect(empty.classList.contains("sobree-section-trailer-empty")).toBe(true);
  });

  it("is a no-op when the last child isn't a section break", () => {
    host.append(p(""));
    collapseSectionTrailerEmpty(host);
    expect(
      (host.firstElementChild as HTMLElement).classList.contains("sobree-section-trailer-empty"),
    ).toBe(false);
  });

  it("is a no-op when the trailer has text content", () => {
    host.append(p("not empty"), sectBreak());
    collapseSectionTrailerEmpty(host);
    expect(
      (host.firstElementChild as HTMLElement).classList.contains("sobree-section-trailer-empty"),
    ).toBe(false);
  });

  it("is a no-op when the trailer carries an image", () => {
    const para = p();
    para.appendChild(doc.createElement("img"));
    host.append(para, sectBreak());
    collapseSectionTrailerEmpty(host);
    expect(para.classList.contains("sobree-section-trailer-empty")).toBe(false);
  });
});
