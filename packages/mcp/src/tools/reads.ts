import type { BlockInfo } from "@sobree/core";
import { emptyObjectSchema } from "./schemas";
import type { ToolDefinition } from "./types";

export const getDocumentTool: ToolDefinition<Record<string, never>, { blocks: BlockInfo[] }> = {
  name: "get_document",
  description:
    "Read the document as an array of block summaries. Each block has an id (use for subsequent mutations), kind (paragraph / section_break / table), a plain-text preview, and a character length. Call this first to understand the document's structure.",
  inputSchema: emptyObjectSchema,
  handler: (sobree) => ({ blocks: sobree.getBlocks() }),
};

export const getOutlineTool: ToolDefinition<
  Record<string, never>,
  { headings: Array<{ level: number; text: string; blockId: string }> }
> = {
  name: "get_outline",
  description:
    "Read the document's heading outline — one entry per heading paragraph (Heading1–Heading6), in document order. Useful for understanding section structure before making structural edits.",
  inputSchema: emptyObjectSchema,
  handler: (sobree) => ({
    headings: sobree.getOutline().map((h) => ({
      level: h.level,
      text: h.text,
      blockId: h.block.id,
    })),
  }),
};
