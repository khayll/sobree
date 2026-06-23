import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "../";
import { emptyDocument, paragraph, text } from "../../doc/builders";
import type { SobreeDocument } from "../../doc/types";

/**
 * A doc exercising every rendered-document concept:
 *   b0 plain paragraph (block lookup)
 *   b1 inline insert (Alice) + inline delete (Bob)
 *   b2 paragraph-mark revision (Carol)
 *   b3 a run that is BOTH inserted AND format-changed (nesting / priority)
 *   b4 a comment range carrying two ids
 */
function doc(): SobreeDocument {
  const d = emptyDocument();
  d.body = [
    paragraph([text("plain block")]),
    paragraph([
      text("kept "),
      text("added", { revision: { type: "ins", author: "Alice" } }),
      text("gone", { revision: { type: "del", author: "Bob" } }),
    ]),
    paragraph([text("whole para")], { revision: { type: "ins", author: "Carol" } }),
    paragraph([
      text("combo", {
        revision: { type: "ins", author: "Dave" },
        revisionFormat: { author: "Dave", before: {} },
      }),
    ]),
    paragraph([text("see ", { commentIds: [1, 2] })]),
  ];
  return d;
}

function setup(): Editor {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new Editor(host, { initialDocument: doc() });
}

let ed: Editor;
afterEach(() => ed?.destroy());

describe("renderedDocument — block lookup", () => {
  it("finds the block element by BlockRef and by id", () => {
    ed = setup();
    const ref = ed.getBlock(0);
    const byRef = ed.renderedDocument.elementForBlock(ref);
    const byId = ed.renderedDocument.elementForBlockId(ref.id);
    expect(byRef).not.toBeNull();
    expect(byRef?.textContent).toContain("plain block");
    expect(byId).toBe(byRef);
  });

  it("resolves a block ref from a nested element with a live version", () => {
    ed = setup();
    const block1 = ed.renderedDocument.elementForBlock(ed.getBlock(1));
    const ins = block1?.querySelector("ins");
    expect(ins).toBeTruthy();
    const ref = ed.renderedDocument.blockRefFromElement(ins!);
    expect(ref?.id).toBe(ed.getBlock(1).id);
    expect(typeof ref?.version).toBe("number");
  });

  it("returns null for an element outside any rendered block", () => {
    ed = setup();
    const orphan = document.createElement("div");
    expect(ed.renderedDocument.blockRefFromElement(orphan)).toBeNull();
    expect(ed.renderedDocument.blockIdFromElement(orphan)).toBeNull();
    expect(ed.renderedDocument.nearestRevisionMark(orphan)).toBeNull();
    expect(ed.renderedDocument.nearestCommentRange(orphan)).toBeNull();
  });
});

describe("renderedDocument — revision discovery", () => {
  it("finds inline insert and delete marks with author + block ref", () => {
    ed = setup();
    const marks = ed.renderedDocument.revisionMarks();
    const ins = marks.find((m) => m.kind === "inline-insert");
    const del = marks.find((m) => m.kind === "inline-delete");
    expect(ins?.author).toBe("Alice");
    expect(del?.author).toBe("Bob");
    expect(ins?.blockRef?.id).toBe(ed.getBlock(1).id);
  });

  it("finds paragraph-mark revisions", () => {
    ed = setup();
    const para = ed.renderedDocument.revisionMarks().find((m) => m.kind === "paragraph");
    expect(para?.author).toBe("Carol");
    expect(para?.blockRef?.id).toBe(ed.getBlock(2).id);
  });

  it("finds format-change revisions", () => {
    ed = setup();
    const fmt = ed.renderedDocument.revisionMarks().find((m) => m.kind === "format");
    expect(fmt?.author).toBe("Dave");
  });

  it("nearestRevisionMark prefers the inline mark over a nested format mark", () => {
    ed = setup();
    const block3 = ed.renderedDocument.elementForBlock(ed.getBlock(3));
    // Renderer nests the format <span> INSIDE the <ins>; hovering the
    // inner span must resolve to the inline insert (accepting it covers
    // both the insertion and the format change).
    const formatSpan = block3?.querySelector("ins span");
    expect(formatSpan).toBeTruthy();
    const mark = ed.renderedDocument.nearestRevisionMark(formatSpan!);
    expect(mark?.kind).toBe("inline-insert");
  });
});

describe("renderedDocument — comment discovery", () => {
  it("finds comment ranges and parses multiple ids", () => {
    ed = setup();
    const ranges = ed.renderedDocument.commentRanges();
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.commentIds).toEqual(["1", "2"]);
    expect(ranges[0]?.blockRef?.id).toBe(ed.getBlock(4).id);
  });

  it("nearestCommentRange resolves from a nested node", () => {
    ed = setup();
    const range = ed.renderedDocument.commentRanges()[0];
    const inner = range!.element.firstChild as Node;
    const nearest = ed.renderedDocument.nearestCommentRange(
      inner.nodeType === Node.TEXT_NODE ? inner.parentElement! : (inner as Element),
    );
    expect(nearest?.commentIds).toEqual(["1", "2"]);
  });
});
