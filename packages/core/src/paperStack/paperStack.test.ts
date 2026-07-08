import { beforeEach, describe, expect, it } from "vitest";

import { defaultSection } from "../doc/builders/document";
import { DEFAULT_PAGE_SETUP } from "../doc/pageSetup";
import type { AnchoredFrame } from "../doc/types";
import {
  type AnchorRenderDeps,
  PaperStack,
  collapseTrailingEmptyPages,
  mergeConsecutiveFragments,
} from "./paperStack";

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
  it("keeps a trailing all-empty page (Word/LO print the blank when it overflowed)", () => {
    // Trailing empty paragraphs are ordinary blocks: when they FIT the
    // last content page the paginator never emits an extra page in the
    // first place; when this pass sees a trailing all-empty page, the
    // empties genuinely OVERFLOWED and Word/LO print a real blank page
    // (pentest-engineer: LO's page 3 has zero text lines). The old
    // unconditional absorb-down existed to mask phantom page-fill and,
    // on nih-icsc, forced empties onto a page whose table rows already
    // overlapped the footer zone.
    const pages = [[p("alpha")], [p(""), p("")]];
    const out = collapseTrailingEmptyPages(pages);
    expect(out).toHaveLength(2);
    expect(out[1]?.map((el) => el.textContent ?? "")).toEqual(["", ""]);
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

describe("mergeConsecutiveFragments — table fragments", () => {
  /** A per-page table fragment as `cloneTableContainer` builds it:
   *  shared data-pag-tid, own colgroup copy, one tbody of rows. */
  function tableFragment(tid: string, rowTexts: string[]): HTMLElement {
    const t = doc.createElement("table");
    t.dataset.pagTid = tid;
    const colgroup = doc.createElement("colgroup");
    for (const w of ["16.529%", "83.471%"]) {
      const col = doc.createElement("col");
      col.style.width = w;
      colgroup.appendChild(col);
    }
    t.appendChild(colgroup);
    const tbody = doc.createElement("tbody");
    for (const text of rowTexts) {
      const tr = doc.createElement("tr");
      const td = doc.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    t.appendChild(tbody);
    return t;
  }

  it("rejoins fragments into one table with a SINGLE colgroup and tbody", () => {
    // The generic child-moving merge accumulated one colgroup copy per
    // fragment; under `table-layout: fixed` each copy multiplies the
    // column count, shrinking the real columns every repagination pass
    // (pentest-engineer's one-table CV exploded 2 pages → 27).
    const container = doc.createElement("div");
    container.appendChild(tableFragment("t1", ["a", "b"]));
    container.appendChild(tableFragment("t1", ["c"]));
    container.appendChild(tableFragment("t1", ["d"]));
    mergeConsecutiveFragments(container);
    const tables = container.querySelectorAll("table");
    expect(tables).toHaveLength(1);
    const t = tables[0] as HTMLElement;
    expect(t.querySelectorAll(":scope > colgroup")).toHaveLength(1);
    expect(t.querySelectorAll(":scope > colgroup > col")).toHaveLength(2);
    expect(t.querySelectorAll(":scope > tbody")).toHaveLength(1);
    const rows = [...t.querySelectorAll("tr")].map((tr) => tr.textContent);
    expect(rows).toEqual(["a", "b", "c", "d"]);
  });

  it("leaves tables with different pag-tids apart", () => {
    const container = doc.createElement("div");
    container.appendChild(tableFragment("t1", ["a"]));
    container.appendChild(tableFragment("t2", ["b"]));
    mergeConsecutiveFragments(container);
    expect(container.querySelectorAll("table")).toHaveLength(2);
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

describe("rich zone selection — titlePg + per-type inheritance", () => {
  function para(text: string) {
    return {
      kind: "paragraph" as const,
      properties: {},
      runs: [{ kind: "text" as const, text, properties: {} }],
    };
  }

  type ZonePick = { partId: string } | null;
  type Pickable = {
    pickRichZone(k: "header" | "footer", si: number, first: boolean): ZonePick;
  };

  function stackWithZones(
    sections: Parameters<PaperStack["setSections"]>[0],
    bodies: Record<string, ReturnType<typeof para>[]>,
  ): Pickable {
    const container = doc.createElement("div");
    doc.body.appendChild(container);
    const stack = new PaperStack(container, DEFAULT_PAGE_SETUP);
    stack.setSections(sections);
    stack.setRichZones({
      headerFooterBodies: bodies,
      numbering: [],
      styles: [],
      rawParts: {},
    });
    return stack as unknown as Pickable;
  }

  it("titlePg with only a first header + only a default footer blanks the missing types", () => {
    // The healthcare CV shape: Word shows the first header ONLY on page 1
    // and the default footer ONLY on pages 2+ — no cross-type borrowing.
    const section = {
      ...defaultSection(),
      titlePage: true,
      headerRefs: [{ type: "first" as const, partId: "header1.xml" }],
      footerRefs: [{ type: "default" as const, partId: "footer1.xml" }],
    };
    const stack = stackWithZones([section], {
      "header1.xml": [para("FIRST HEADER")],
      "footer1.xml": [para("Page N")],
    });
    expect(stack.pickRichZone("header", 0, true)?.partId).toBe("header1.xml");
    expect(stack.pickRichZone("header", 0, false)).toBeNull(); // no default header → blank
    expect(stack.pickRichZone("footer", 0, true)).toBeNull(); // no first footer → blank title page
    expect(stack.pickRichZone("footer", 0, false)?.partId).toBe("footer1.xml");
  });

  it("a section declaring only a first footer inherits the DEFAULT footer per type", () => {
    // OOXML §17.10.3 — inheritance is per TYPE: cms's later sections
    // declare only first-page footers yet keep the chapter footer on
    // their body pages.
    const s0 = {
      ...defaultSection(),
      footerRefs: [{ type: "default" as const, partId: "footerA.xml" }],
    };
    const s1 = {
      ...defaultSection(),
      titlePage: true,
      footerRefs: [{ type: "first" as const, partId: "footerB.xml" }],
    };
    const stack = stackWithZones([s0, s1], {
      "footerA.xml": [para("CHAPTER FOOTER")],
      "footerB.xml": [para("SECTION COVER")],
    });
    // Section 1's body pages: default lookup walks back to section 0.
    expect(stack.pickRichZone("footer", 1, false)?.partId).toBe("footerA.xml");
    // Section 1's first page keeps its own first footer.
    expect(stack.pickRichZone("footer", 1, true)?.partId).toBe("footerB.xml");
  });
});
