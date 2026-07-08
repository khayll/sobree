import { afterEach, describe, expect, it } from "vitest";
import { createSobree } from "../createSobree";
import type { SobreeHandle } from "../createSobree";
import { emptyDocument, heading, paragraph, text } from "../doc/builders";
import { CLS_PAPER, CLS_PAPER_COMMENTS, CLS_PAPER_HEADER } from "./paperClasses";

/**
 * `sobree.paperLayout` is the typed replacement for plugins reaching into
 * `.paper*` page-DOM selectors. These prove the bridge answers the three
 * questions plugins need: what pages exist, which page owns an element,
 * and whether an element is in a header/footer zone.
 */
const handles: SobreeHandle[] = [];

function mount(): SobreeHandle {
  const host = document.createElement("div");
  Object.assign(host.style, { width: "1200px", height: "800px" });
  document.body.appendChild(host);
  const doc = emptyDocument();
  doc.body = [heading(1, [text("Title")]), paragraph([text("a body paragraph")])];
  const h = createSobree(host, { content: doc });
  handles.push(h);
  return h;
}

afterEach(() => {
  while (handles.length) handles.pop()?.destroy();
  document.body.innerHTML = "";
});

describe("sobree.paperLayout", () => {
  it("enumerates rendered pages with their card + comment mount slot", () => {
    const h = mount();
    const papers = h.sobree.paperLayout.papers();
    expect(papers.length).toBeGreaterThanOrEqual(1);
    for (const p of papers) {
      expect(p.root.classList.contains(CLS_PAPER)).toBe(true);
      expect(p.commentSlot.classList.contains(CLS_PAPER_COMMENTS)).toBe(true);
      // The comment slot lives inside the same row as its page card.
      expect(p.root.parentElement?.contains(p.commentSlot)).toBe(true);
    }
  });

  it("resolves the page card containing a body element", () => {
    const h = mount();
    const blockEl = h.editor.renderedDocument.elementForBlock(h.editor.getBlock(0));
    expect(blockEl).not.toBeNull();
    const paper = h.sobree.paperLayout.nearestPaper(blockEl!);
    expect(paper).not.toBeNull();
    expect(paper?.classList.contains(CLS_PAPER)).toBe(true);
    expect(paper?.contains(blockEl)).toBe(true);
  });

  it("returns null for an element outside the paper stack", () => {
    const h = mount();
    const stray = document.createElement("div");
    document.body.appendChild(stray);
    expect(h.sobree.paperLayout.nearestPaper(stray)).toBeNull();
    expect(h.sobree.paperLayout.nearestZone(stray)).toBeNull();
    stray.remove();
  });

  it("detects the header zone and treats body content as no zone", () => {
    const h = mount();
    const header = h.sobree.stackRoot.querySelector<HTMLElement>(`.${CLS_PAPER_HEADER}`);
    expect(header).not.toBeNull();
    const zone = h.sobree.paperLayout.nearestZone(header!);
    expect(zone?.zone).toBe("header");
    expect(zone?.element).toBe(header);

    const blockEl = h.editor.renderedDocument.elementForBlock(h.editor.getBlock(0));
    expect(h.sobree.paperLayout.nearestZone(blockEl!)).toBeNull();
  });
});
