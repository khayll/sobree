/**
 * Tool handler tests. We exercise the handlers against a real
 * `HeadlessSobree` (no mocks) — this is what the MCP transport layer
 * does at runtime. The MCP transport itself is exercised by the
 * server.test.ts integration test.
 */

import {
  HeadlessSobree,
  type HeadlessSobree as HeadlessSobreeType,
  appendBlock,
  emptyDocument,
  heading,
  paragraph,
  text,
} from "@sobree/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  ALL_TOOLS,
  deleteBlockTool,
  findTool,
  getDocumentTool,
  getOutlineTool,
  insertParagraphAfterTool,
  insertParagraphBeforeTool,
  redoTool,
  replaceParagraphTool,
  setParagraphAlignmentTool,
  undoTool,
} from "./tools";

describe("tool registry", () => {
  it("findTool returns the right tool by name", () => {
    expect(findTool("get_document")?.name).toBe("get_document");
    expect(findTool("nope")).toBeUndefined();
  });

  it("ALL_TOOLS contains every defined tool exactly once", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    // Sanity: must include the read tools and core mutators.
    for (const expected of [
      "get_document",
      "get_outline",
      "insert_paragraph_after",
      "insert_paragraph_before",
      "replace_paragraph",
      "delete_block",
      "set_paragraph_alignment",
      "undo",
      "redo",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("every tool has a non-empty description and an input schema", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema).toBeTypeOf("object");
    }
  });
});

describe("read tools", () => {
  let sobree: HeadlessSobreeType;
  beforeEach(() => {
    const initial = emptyDocument();
    appendBlock(initial, heading(1, [text("Title")]));
    appendBlock(initial, paragraph([text("Body 1.")]));
    appendBlock(initial, paragraph([text("Body 2.")]));
    sobree = new HeadlessSobree(new Y.Doc(), { initialDocument: initial });
  });
  afterEach(() => sobree.destroy());

  it("get_document returns block summaries", async () => {
    const result = await getDocumentTool.handler(sobree, {});
    expect(result.blocks.length).toBe(4);
    // Index 1 is the heading we appended (index 0 is the empty
    // doc's default paragraph).
    expect(result.blocks[1]?.kind).toBe("paragraph");
  });

  it("get_outline returns one entry per heading", async () => {
    const result = await getOutlineTool.handler(sobree, {});
    expect(result.headings.length).toBe(1);
    expect(result.headings[0]?.text).toBe("Title");
    expect(result.headings[0]?.level).toBe(1);
  });
});

describe("mutation tools", () => {
  let sobree: HeadlessSobreeType;
  beforeEach(() => {
    const initial = emptyDocument();
    appendBlock(initial, paragraph([text("first")]));
    appendBlock(initial, paragraph([text("second")]));
    sobree = new HeadlessSobree(new Y.Doc(), { initialDocument: initial });
  });
  afterEach(() => sobree.destroy());

  it("insert_paragraph_after inserts at the right position", async () => {
    const target = sobree.getBlock(1);
    const result = await insertParagraphAfterTool.handler(sobree, {
      afterBlockId: target.id,
      text: "inserted",
    });
    expect(result.blockId).toBeTruthy();
    const blocks = sobree.getBlocks();
    expect(blocks[2]?.text).toBe("inserted");
  });

  it("insert_paragraph_before inserts at the right position", async () => {
    const target = sobree.getBlock(2);
    const result = await insertParagraphBeforeTool.handler(sobree, {
      beforeBlockId: target.id,
      text: "wedged",
    });
    expect(result.blockId).toBeTruthy();
    expect(sobree.getBlocks()[2]?.text).toBe("wedged");
  });

  it("replace_paragraph swaps content", async () => {
    const target = sobree.getBlock(1);
    await replaceParagraphTool.handler(sobree, {
      blockId: target.id,
      text: "rewritten",
    });
    expect(sobree.getBlock(1).text).toBe("rewritten");
  });

  it("delete_block removes a block", async () => {
    const target = sobree.getBlock(1);
    const before = sobree.getBlocks().length;
    await deleteBlockTool.handler(sobree, { blockId: target.id });
    expect(sobree.getBlocks().length).toBe(before - 1);
  });

  it("set_paragraph_alignment sets the alignment", async () => {
    const target = sobree.getBlock(1);
    await setParagraphAlignmentTool.handler(sobree, {
      blockId: target.id,
      alignment: "center",
    });
    const block = sobree.getDocument().body[1];
    if (block?.kind !== "paragraph") throw new Error("expected paragraph");
    expect(block.properties.alignment).toBe("center");
  });

  it("mutations on a non-existent blockId throw a helpful message", () => {
    // The handler can throw synchronously (lookupRef errors before
    // any Promise wrapping) or via a rejected Promise; either path
    // is fine. We wrap in a thunk so toThrow handles both.
    expect(() =>
      replaceParagraphTool.handler(sobree, {
        blockId: "fake-id-123",
        text: "x",
      }),
    ).toThrow(/not found/i);
  });
});

describe("history tools", () => {
  let sobree: HeadlessSobreeType;
  beforeEach(() => {
    const initial = emptyDocument();
    appendBlock(initial, paragraph([text("orig")]));
    sobree = new HeadlessSobree(new Y.Doc(), { initialDocument: initial });
  });
  afterEach(() => sobree.destroy());

  it("undo reverses a mutation; redo re-applies it", async () => {
    const target = sobree.getBlock(1);
    await replaceParagraphTool.handler(sobree, {
      blockId: target.id,
      text: "modified",
    });
    expect(sobree.getBlock(1).text).toBe("modified");

    const u = await undoTool.handler(sobree, {});
    expect(u.undone).toBe(true);
    expect(sobree.getBlock(1).text).toBe("orig");

    const r = await redoTool.handler(sobree, {});
    expect(r.redone).toBe(true);
    expect(sobree.getBlock(1).text).toBe("modified");
  });

  it("undo on empty history returns undone:false (not an error)", async () => {
    const result = await undoTool.handler(sobree, {});
    expect(result.undone).toBe(false);
  });
});
