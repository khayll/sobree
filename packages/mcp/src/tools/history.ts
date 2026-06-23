import { emptyObjectSchema } from "./schemas";
import type { ToolDefinition } from "./types";

export const undoTool: ToolDefinition<Record<string, never>, { undone: boolean }> = {
  name: "undo",
  description:
    "Reverse the most recent edit made by this MCP peer. Doesn't affect edits made by humans or other peers (per-peer undo via Y.UndoManager).",
  inputSchema: emptyObjectSchema,
  handler: (sobree) => ({ undone: sobree.history.undo() }),
};

export const redoTool: ToolDefinition<Record<string, never>, { redone: boolean }> = {
  name: "redo",
  description: "Re-apply the most recently undone edit by this MCP peer.",
  inputSchema: emptyObjectSchema,
  handler: (sobree) => ({ redone: sobree.history.redo() }),
};
