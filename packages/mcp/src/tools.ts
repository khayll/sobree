/**
 * Tool definitions for the Sobree MCP server.
 *
 * Each tool maps a Model Context Protocol invocation to a
 * `HeadlessSobree` mutation or read. Inputs are JSON Schema; outputs
 * are JSON-serialisable. The MCP transport layer (stdio, SSE, etc.)
 * is decoupled — these handlers are pure (input → output, plus side
 * effects on the supplied `HeadlessSobree`).
 *
 * # Design principles
 *
 *   1. **Small surface.** v0 ships the mutations LLMs actually need:
 *      reading structure, inserting paragraphs, replacing paragraph
 *      text, deleting blocks, setting alignment, undo/redo.
 *   2. **Block ids in / block ids out.** Every mutation takes a
 *      `blockId` and returns the updated id list (or the new ref's
 *      id). LLMs don't need to track versions — the optimistic-lock
 *      check is server-side; on conflict the tool errors with a
 *      message the LLM can act on.
 *   3. **Plain-text bias.** v0 mutations accept plain text. Rich
 *      formatting (bold, color, headings) lives in the document
 *      structure the LLM reads via `get_blocks` / `get_document`;
 *      mutations that need formatting use `replace_paragraph` with
 *      a typed `runs` payload (next iteration).
 */

import {
  type BlockInfo,
  type BlockRef,
  type HeadlessSobree,
  paragraph,
  text,
} from "@sobree/core";

/**
 * Common JSON Schema for input validation. We use a minimal subset —
 * just enough for the MCP SDK to validate inputs before our handlers
 * run. The SDK ships its own validator.
 */
export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: object;
  handler: (sobree: HeadlessSobree, input: I) => Promise<O> | O;
}

// === reads ===

export const getDocumentTool: ToolDefinition<
  Record<string, never>,
  { blocks: BlockInfo[] }
> = {
  name: "get_document",
  description:
    "Read the document as an array of block summaries. Each block has an id (use for subsequent mutations), kind (paragraph / section_break / table), a plain-text preview, and a character length. Call this first to understand the document's structure.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  handler: (sobree) => ({ blocks: sobree.getBlocks() }),
};

export const getOutlineTool: ToolDefinition<
  Record<string, never>,
  { headings: Array<{ level: number; text: string; blockId: string }> }
> = {
  name: "get_outline",
  description:
    "Read the document's heading outline — one entry per heading paragraph (Heading1–Heading6), in document order. Useful for understanding section structure before making structural edits.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  handler: (sobree) => ({
    headings: sobree.getOutline().map((h) => ({
      level: h.level,
      text: h.text,
      blockId: h.block.id,
    })),
  }),
};

// === mutations ===

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
      afterBlockId: {
        type: "string",
        description: "The id of the block to insert after. Get from get_document.",
      },
      text: {
        type: "string",
        description: "Plain text content for the new paragraph.",
      },
    },
    required: ["afterBlockId", "text"],
  },
  handler: (sobree, input) => {
    const ref = lookupRef(sobree, input.afterBlockId, "afterBlockId");
    const result = sobree.insertBlockAfter(
      ref,
      paragraph([text(input.text)]),
    );
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
      beforeBlockId: {
        type: "string",
        description: "The id of the block to insert before.",
      },
      text: {
        type: "string",
        description: "Plain text content for the new paragraph.",
      },
    },
    required: ["beforeBlockId", "text"],
  },
  handler: (sobree, input) => {
    const ref = lookupRef(sobree, input.beforeBlockId, "beforeBlockId");
    const result = sobree.insertBlockBefore(
      ref,
      paragraph([text(input.text)]),
    );
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
      blockId: { type: "string", description: "Id of the paragraph to replace." },
      text: { type: "string", description: "New plain text content." },
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

export const deleteBlockTool: ToolDefinition<
  { blockId: string },
  { deleted: string }
> = {
  name: "delete_block",
  description:
    "Delete the block with the given id. If this would empty the document, an empty paragraph is left in its place.",
  inputSchema: {
    type: "object",
    properties: {
      blockId: { type: "string", description: "Id of the block to delete." },
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

export const setParagraphAlignmentTool: ToolDefinition<
  { blockId: string; alignment: "left" | "center" | "right" | "both" | "distribute" },
  { blockId: string }
> = {
  name: "set_paragraph_alignment",
  description:
    "Set the text alignment of a paragraph block. `both` is OOXML's name for full justification.",
  inputSchema: {
    type: "object",
    properties: {
      blockId: { type: "string" },
      alignment: {
        type: "string",
        enum: ["left", "center", "right", "both", "distribute"],
      },
    },
    required: ["blockId", "alignment"],
  },
  handler: (sobree, input) => {
    const ref = lookupRef(sobree, input.blockId, "blockId");
    const result = sobree.applyBlockProperties([ref], {
      alignment: input.alignment,
    });
    if (!result.ok) throw new Error(formatEditError(result.error));
    return { blockId: input.blockId };
  },
};

// === history ===

export const undoTool: ToolDefinition<Record<string, never>, { undone: boolean }> = {
  name: "undo",
  description:
    "Reverse the most recent edit made by this MCP peer. Doesn't affect edits made by humans or other peers (per-peer undo via Y.UndoManager).",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: (sobree) => ({ undone: sobree.history.undo() }),
};

export const redoTool: ToolDefinition<Record<string, never>, { redone: boolean }> = {
  name: "redo",
  description: "Re-apply the most recently undone edit by this MCP peer.",
  inputSchema: { type: "object", properties: {}, required: [] },
  handler: (sobree) => ({ redone: sobree.history.redo() }),
};

// === registry ===

/** The complete tool set in registration order. */
export const ALL_TOOLS: readonly ToolDefinition[] = [
  getDocumentTool,
  getOutlineTool,
  insertParagraphAfterTool,
  insertParagraphBeforeTool,
  replaceParagraphTool,
  deleteBlockTool,
  setParagraphAlignmentTool,
  undoTool,
  redoTool,
] as ToolDefinition[];

/** Look up a tool by name. Used by the MCP server's dispatch. */
export function findTool(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

// === internals ===

/**
 * Resolve a block id to a BlockRef (with current version) for the
 * editor's optimistic-lock check. Throws a user-facing error if the
 * id doesn't exist — the LLM may have referenced a deleted block.
 */
function lookupRef(
  sobree: HeadlessSobree,
  blockId: string,
  field: string,
): BlockRef {
  const info = sobree.getBlockById(blockId);
  if (!info) {
    throw new Error(
      `${field}: block ${JSON.stringify(blockId)} not found. ` +
        "Call get_document to refresh block ids — the document may have changed.",
    );
  }
  return { id: info.id, version: info.version };
}

/** Format an EditError as a human-readable string for the LLM. */
function formatEditError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const e = err as { code: string; details?: string; conflicts?: unknown };
    if (e.code === "optimistic-lock") {
      return (
        "optimistic-lock: another peer modified this block between your read and write. " +
          "Call get_document to refresh and try again."
      );
    }
    return `${e.code}${e.details ? `: ${e.details}` : ""}`;
  }
  return String(err);
}
