import { paragraph, text } from "@sobree/core";
import { formatEditError, lookupRef } from "./internals";
import { blockIdSchema, textSchema } from "./schemas";
import type { ToolDefinition } from "./types";

export const insertParagraphAfterTool: ToolDefinition<
  { afterBlockId: string; text: string },
  { blockId: string }
> = {
  name: "insert_paragraph_after",
  description:
    "Insert a new plain-text paragraph immediately after the block with the given id. Returns the new block's id so subsequent mutations can target it.",
  inputSchema: {
    type: "object",
    properties: {
      afterBlockId: blockIdSchema("The id of the block to insert after. Get from get_document."),
      text: textSchema("Plain text content for the new paragraph."),
    },
    required: ["afterBlockId", "text"],
  },
  handler: (sobree, input) => {
    const ref = lookupRef(sobree, input.afterBlockId, "afterBlockId");
    const result = sobree.insertBlockAfter(ref, paragraph([text(input.text)]));
    if (!result.ok) throw new Error(formatEditError(result.error));
    const newRef = result.affected?.[0];
    if (!newRef) throw new Error("insertBlockAfter returned no new ref");
    return { blockId: newRef.id };
  },
};

export const insertParagraphBeforeTool: ToolDefinition<
  { beforeBlockId: string; text: string },
  { blockId: string }
> = {
  name: "insert_paragraph_before",
  description:
    "Insert a new plain-text paragraph immediately before the block with the given id. Returns the new block's id.",
  inputSchema: {
    type: "object",
    properties: {
      beforeBlockId: blockIdSchema("The id of the block to insert before."),
      text: textSchema("Plain text content for the new paragraph."),
    },
    required: ["beforeBlockId", "text"],
  },
  handler: (sobree, input) => {
    const ref = lookupRef(sobree, input.beforeBlockId, "beforeBlockId");
    const result = sobree.insertBlockBefore(ref, paragraph([text(input.text)]));
    if (!result.ok) throw new Error(formatEditError(result.error));
    const newRef = result.affected?.[0];
    if (!newRef) throw new Error("insertBlockBefore returned no new ref");
    return { blockId: newRef.id };
  },
};

export const replaceParagraphTool: ToolDefinition<
  { blockId: string; text: string },
  { blockId: string }
> = {
  name: "replace_paragraph",
  description:
    "Replace the entire content of a paragraph block with new plain text. Drops any existing formatting (bold, color, etc.) in that paragraph. For preserving structure / formatting, read the block first, modify the runs, and use replace_paragraph_runs (future tool).",
  inputSchema: {
    type: "object",
    properties: {
      blockId: blockIdSchema("Id of the paragraph to replace."),
      text: textSchema("New plain text content."),
    },
    required: ["blockId", "text"],
  },
  handler: (sobree, input) => {
    const ref = lookupRef(sobree, input.blockId, "blockId");
    const result = sobree.replaceBlock(ref, paragraph([text(input.text)]));
    if (!result.ok) throw new Error(formatEditError(result.error));
    return { blockId: input.blockId };
  },
};

export const deleteBlockTool: ToolDefinition<{ blockId: string }, { deleted: string }> = {
  name: "delete_block",
  description:
    "Delete the block with the given id. If this would empty the document, an empty paragraph is left in its place.",
  inputSchema: {
    type: "object",
    properties: {
      blockId: blockIdSchema("Id of the block to delete."),
    },
    required: ["blockId"],
  },
  handler: (sobree, input) => {
    const ref = lookupRef(sobree, input.blockId, "blockId");
    const result = sobree.deleteBlock(ref);
    if (!result.ok) throw new Error(formatEditError(result.error));
    return { deleted: input.blockId };
  },
};
