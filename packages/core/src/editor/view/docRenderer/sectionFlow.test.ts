import { beforeEach, describe, expect, it } from "vitest";

import type { SectionProperties } from "../../../doc/types";
import {
  collapseSectionTrailerEmpty,
  evictTrailingEmptyParagraphs,
  openColumnContainerIfNeeded,
} from "./sectionFlow";

const doc = window.document;

function section(over: Partial<SectionProperties> = {}): SectionProperties {
  return {
    pageSize: { wTwips: 11906, hTwips: 16838, orientation: "portrait" },
    pageMargins: {
      topTwips: 1440, rightTwips: 1440, bottomTwips: 1440, leftTwips: 1440,
      headerTwips: 720, footerTwips: 720, gutterTwips: 0,
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
beforeEach(() => { host = doc.createElement("div"); });

describe("openColumnContainerIfNeeded", () => {
  it("returns the host unchanged for single-column sections", () => {
    expect(openColumnContainerIfNeeded(host, undefined)).toBe(host);
    expect(openColumnContainerIfNeeded(host, section({ columns: { count: 1 } }))).toBe(host);
    expect(host.children).toHaveLength(0);
  });

  it("creates a column container with the requested count + gap", () => {
    const wrapper = openColumnContainerIfNeeded(
      host,
      section({ columns: { count: 2, spaceTwips: 720 } }),
    );
    expect(wrapper).not.toBe(host);
    expect(wrapper.className).toBe("sobree-section-cols");
    expect(wrapper.style.columnCount).toBe("2");
    // 720 twips → 13mm (rounded)
    expect(wrapper.style.columnGap).toBe("13mm");
    expect(host.firstElementChild).toBe(wrapper);
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
    expect((host.firstElementChild as HTMLElement).classList.contains("sobree-section-trailer-empty")).toBe(false);
  });

  it("is a no-op when the trailer has text content", () => {
    host.append(p("not empty"), sectBreak());
    collapseSectionTrailerEmpty(host);
    expect((host.firstElementChild as HTMLElement).classList.contains("sobree-section-trailer-empty")).toBe(false);
  });

  it("is a no-op when the trailer carries an image", () => {
    const para = p();
    para.appendChild(doc.createElement("img"));
    host.append(para, sectBreak());
    collapseSectionTrailerEmpty(host);
    expect(para.classList.contains("sobree-section-trailer-empty")).toBe(false);
  });
});
