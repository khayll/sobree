/**
 * @sobree/mcp — Model Context Protocol server for Sobree.
 *
 * Lets an LLM (Claude Desktop, Anthropic API tool-use, any
 * MCP-aware client) read and edit a Sobree document via standardized
 * tool calls. Internally wraps `HeadlessSobree`, so all the same
 * Y.Doc + UndoManager + per-peer-undo guarantees apply.
 *
 * # Two ways to use this
 *
 *   1. **As a library.** `createSobreeMcpServer(...)` returns an
 *      MCP server you connect to a transport of your choice
 *      (stdio, SSE, HTTP). Useful when embedding the MCP surface
 *      in a larger Node app.
 *
 *   2. **As a CLI.** `npx @sobree/mcp` (or
 *      `sobree-mcp` after install) launches a stdio-mode server,
 *      ready to wire into Claude Desktop's `claude_desktop_config.json`.
 *      Pass `--ws-url` + `--room` to attach to a `@sobree/collab-server`
 *      and edit alongside human peers.
 */

export { createSobreeMcpServer } from "./server";
export type {
  CreateSobreeMcpServerOptions,
  SobreeMcpServer,
} from "./server";
export { ALL_TOOLS, findTool } from "./tools";
export type { ToolDefinition } from "./tools";
