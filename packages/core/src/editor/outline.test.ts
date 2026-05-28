import { appendBlock, emptyDocument, heading, paragraph, text } from "../doc/builders";
import type { SobreeDocument } from "../doc/types";
import { Editor } from "./";
import { describe, expect, it } from "vitest";

function setupEditor(doc: SobreeDocument): Editor {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new Editor(host, { initialDocument: doc });
}

function makeDoc(build: (doc: SobreeDocument) => void): SobreeDocument {
  const d = emptyDocument();
  d.body = [];
  build(d);
  return d;
}

describe("getOutline", () => {
  it("lists headings in document order with their levels and text", () => {
    const doc = makeDoc((d) => {
      appendBlock(d, heading(1, [text("One")]));
      appendBlock(d, paragraph([text("body")]));
      appendBlock(d, heading(2, [text("Two")]));
      appendBlock(d, paragraph([text("more")]));
      appendBlock(d, heading(3, [text("Three")]));
      appendBlock(d, paragraph([text("last")]));
    });
    const ed = setupEditor(doc);
    expect(ed.getOutline().map((h) => [h.level, h.text])).toEqual([
      [1, "One"],
      [2, "Two"],
      [3, "Three"],
    ]);
    ed.destroy();
  });

  it("returns block indices that round-trip through getBlock", () => {
    const doc = makeDoc((d) => {
      appendBlock(d, heading(1, [text("One")]));
      appendBlock(d, paragraph([text("body")]));
      appendBlock(d, heading(2, [text("Two")]));
      appendBlock(d, paragraph([text("more")]));
    });
    const ed = setupEditor(doc);
    for (const h of ed.getOutline()) {
      const block = ed.getBlock(h.blockIndex);
      expect(block.kind).toBe("paragraph");
      expect(block.styleId).toMatch(/^Heading[1-6]$/);
    }
    ed.destroy();
  });

  it("flattens inline formatting inside heading text", () => {
    const doc = makeDoc((d) => {
      appendBlock(d, heading(1, [text("Hello "), text("world", { italic: true })]));
    });
    const ed = setupEditor(doc);
    expect(ed.getOutline()[0]?.text).toBe("Hello world");
    ed.destroy();
  });

  it("returns an empty list when there are no headings", () => {
    const doc = makeDoc((d) => {
      appendBlock(d, paragraph([text("just a paragraph.")]));
    });
    const ed = setupEditor(doc);
    expect(ed.getOutline()).toEqual([]);
    ed.destroy();
  });
});
