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
