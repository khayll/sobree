import { describe, expect, it } from "vitest";
import type { Block } from "../../../doc/types";
import { renderBlocks } from "./block";

const doc = window.document;

/** An empty paragraph whose only content is a page-break run. */
const breakPara = (): Block => ({
  kind: "paragraph",
  properties: {},
  runs: [{ kind: "break", type: "page" }],
});
/** An empty paragraph (no content, no break). */
const emptyPara = (): Block => ({ kind: "paragraph", properties: {}, runs: [] });
const textPara = (t: string): Block => ({
  kind: "paragraph",
  properties: {},
  runs: [{ kind: "text", text: t, properties: {} }],
});

function render(blocks: Block[], frameAnchored: Set<number> = new Set()): HTMLElement {
  const host = doc.createElement("div");
  renderBlocks(blocks, host, [], [], {}, undefined, [], frameAnchored);
  return host;
}

const breakBeforeFlags = (host: HTMLElement) =>
  Array.from(host.children).map((c) => c.hasAttribute("data-page-break-before"));

describe("renderBlocks — page-break deferral", () => {
  it("defers an empty break paragraph's break to the next FRAME-ANCHORED page", () => {
    // The trifold case: block 0 is an empty page-break paragraph anchoring
    // page-1 floats; block 1 is body-empty but anchors page-2 floats. The
    // break must land BEFORE block 1 (so block 0 stays on page 1) — not
    // before block 0 (which would push everything to page 2).
    const host = render([breakPara(), emptyPara()], new Set([1]));
    expect(breakBeforeFlags(host)).toEqual([false, true]);
    // The break run was stripped from block 0 so it doesn't re-stamp.
    expect(host.children[0]?.querySelector(".page-break")).toBeNull();
  });

  it("defers past empty filler paragraphs to the next non-empty block", () => {
    // complex-multipage case: break paragraph, empty filler, then real
    // content. The break lands before the content, skipping the fillers.
    const host = render([breakPara(), emptyPara(), textPara("Chapter 2")]);
    expect(breakBeforeFlags(host)).toEqual([false, false, true]);
  });

  it("does not put the break before the empty paragraph that carries it", () => {
    const host = render([breakPara(), textPara("X")]);
    expect(host.children[0]?.hasAttribute("data-page-break-before")).toBe(false);
  });
});

describe("renderBlocks — table style pPr reaches cell paragraphs", () => {
  it("cell paragraphs take TableGrid's line/after over DocDefaults; body paragraphs don't", () => {
    // nih-icsc shape: DocDefaults says line=276 after=200; the table's
    // TableGrid style zeroes after-spacing and singles line spacing for
    // every paragraph INSIDE the table (ECMA-376 §17.7.2). LO's measured
    // in-table pitch is single; skipping this layer rendered every cell
    // ~1.4pt/line taller and spilled table-heavy documents onto extra pages.
    const styles = [
      {
        id: "DocDefaults",
        type: "paragraph" as const,
        displayName: "Document defaults",
        paragraphDefaults: {
          spacing: { afterTwips: 200, line: 276, lineRule: "auto" as const },
        },
      },
      { id: "Normal", type: "paragraph" as const, displayName: "Normal", basedOn: "DocDefaults" },
      { id: "TableNormal", type: "table" as const, displayName: "Normal Table" },
      {
        id: "TableGrid",
        type: "table" as const,
        displayName: "Table Grid",
        basedOn: "TableNormal",
        paragraphDefaults: { spacing: { afterTwips: 0, line: 240, lineRule: "auto" as const } },
      },
    ];
    const blocks: Block[] = [
      textPara("body"),
      {
        kind: "table",
        properties: { styleId: "TableGrid" },
        grid: [2000],
        rows: [
          {
            cells: [
              {
                content: [
                  {
                    kind: "paragraph",
                    properties: {},
                    runs: [{ kind: "text", text: "cell", properties: {} }],
                  },
                ],
              },
            ],
          },
        ],
      } as Block,
    ];
    const host = doc.createElement("div");
    renderBlocks(blocks, host, [], styles, {});
    const bodyP = host.querySelector(":scope > p") as HTMLElement;
    const cellP = host.querySelector("td p") as HTMLElement;
    // Body paragraph: DocDefaults' 276-line multiplier applies.
    expect(bodyP.style.lineHeight).not.toBe("");
    expect(Number.parseFloat(bodyP.style.lineHeight)).toBeGreaterThan(1.3);
    // Cell paragraph: TableGrid's single spacing + after=0 win.
    expect(Number.parseFloat(cellP.style.lineHeight)).toBeCloseTo(1.15, 2);
    expect(cellP.style.marginBottom).toBe("0px");
  });
});
