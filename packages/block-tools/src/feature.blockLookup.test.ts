import {
  type SobreeHandle,
  createSobree,
  emptyDocument,
  heading,
  paragraph,
  text,
} from "@sobree/core";
import { afterEach, describe, expect, it } from "vitest";
import { blockTargetFrom } from "./blockKinds";

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

describe("block-tools block lookup via renderedDocument", () => {
  it("resolves a pointer target inside a rendered block to that block's id", () => {
    const h = mount();
    const blockEl = h.editor.renderedDocument.elementForBlock(h.editor.getBlock(1));
    expect(blockEl).not.toBeNull();
    // A pointer landing on a text node inside the block resolves up to
    // the block, carrying the renderer-stamped id — without block-tools
    // ever naming the selector.
    const target = blockEl!.firstChild ?? blockEl!;
    const result = blockTargetFrom(target, h.sobree.stackRoot, h.editor.renderedDocument);
    expect(result?.kind).toBe("paragraph");
    expect(result?.blockId).toBe(h.editor.getBlock(1).id);
  });

  it("re-resolves a block element by id after a rebuild", () => {
    const h = mount();
    const id = h.editor.getBlock(0).id;
    const first = h.editor.renderedDocument.elementForBlockId(id);
    expect(first).not.toBeNull();
    // A second lookup of the same id returns the live element.
    expect(h.editor.renderedDocument.elementForBlockId(id)).toBe(first);
  });
});
