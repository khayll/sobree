import { deleteBlockTool, insertParagraphAfterTool, insertParagraphBeforeTool, replaceParagraphTool } from "./blocks";
import { setParagraphAlignmentTool } from "./formatting";
import { redoTool, undoTool } from "./history";
import { getDocumentTool, getOutlineTool } from "./reads";
import type { ToolDefinition } from "./types";

export { deleteBlockTool, insertParagraphAfterTool, insertParagraphBeforeTool, replaceParagraphTool };
export { setParagraphAlignmentTool };
export { redoTool, undoTool };
export { getDocumentTool, getOutlineTool };
export type { ToolDefinition } from "./types";

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
