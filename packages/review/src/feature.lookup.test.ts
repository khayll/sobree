import {
  type SobreeContent,
  type SobreeHandle,
  createSobree,
  emptyDocument,
  paragraph,
  text,
} from "@sobree/core";
import { afterEach, describe, expect, it } from "vitest";
import { review } from "./index";

const handles: SobreeHandle[] = [];

function mount(content: SobreeContent): SobreeHandle {
  const host = document.createElement("div");
  Object.assign(host.style, { width: "1200px", height: "800px" });
  document.body.appendChild(host);
  const h = createSobree(host, { content, plugins: [review()] });
  handles.push(h);
  return h;
}

/** Let the review controller's rAF/timer-debounced refresh run. */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 120));
}

afterEach(() => {
  while (handles.length) handles.pop()?.destroy();
  document.body.innerHTML = "";
});

describe("review surface driven by renderedDocument", () => {
  it("colours inline, paragraph, and format marks per author", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([text("kept "), text("added", { revision: { type: "ins", author: "Alice" } })]),
      paragraph([text("para")], { revision: { type: "ins", author: "Bob" } }),
      paragraph([text("fmt", { revisionFormat: { author: "Carol", before: {} } })]),
    ];
    const h = mount(doc);
    await flush();
    const rd = h.editor.renderedDocument;
    const inline = rd.revisionMarks().find((m) => m.kind === "inline-insert");
    const para = rd.revisionMarks().find((m) => m.kind === "paragraph");
    const fmt = rd.revisionMarks().find((m) => m.kind === "format");
    expect(inline?.element.style.getPropertyValue("--author-color")).toBeTruthy();
    expect(para?.element.style.getPropertyValue("--sobree-block-revision-color")).toBeTruthy();
    expect(fmt?.element.style.getPropertyValue("--sobree-format-revision-color")).toBeTruthy();
  });

  it("renders a comment card for a discovered comment range", async () => {
    const doc = emptyDocument();
    doc.body = [paragraph([text("annotated", { commentIds: [1] })])];
    doc.comments = {
      1: { id: 1, author: "Alice", body: [paragraph([text("a note")])] },
    };
    const h = mount(doc);
    await flush();
    const ranges = h.editor.renderedDocument.commentRanges();
    expect(ranges[0]?.commentIds).toEqual(["1"]);
    const card = h.sobree.stackRoot.querySelector(".sobree-review-card");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("a note");
  });

  it("accept-all clears revisions surfaced through the lookup", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([text("kept "), text("added", { revision: { type: "ins", author: "Alice" } })]),
    ];
    const h = mount(doc);
    await flush();
    expect(h.editor.renderedDocument.revisionMarks().length).toBeGreaterThan(0);
    const r = h.editor.acceptAllRevisions();
    expect(r.ok).toBe(true);
    await flush();
    expect(h.editor.getRevisions()).toHaveLength(0);
    expect(h.editor.renderedDocument.revisionMarks()).toHaveLength(0);
  });
});
