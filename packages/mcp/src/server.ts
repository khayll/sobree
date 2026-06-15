/**
 * `createSobreeMcpServer` — wires `HeadlessSobree` to an MCP `Server`
 * using the official `@modelcontextprotocol/sdk`.
 *
 * # Two operating modes
 *
 *   - **Local** — the server holds its own Y.Doc, no provider. The
 *     LLM is the only writer. Useful for "give me a Sobree document
 *     to dictate into" workflows.
 *
 *   - **Collab** — the caller passes a Y.Doc that's synced to a
 *     collab-server (via `y-websocket`'s `WebsocketProvider`). The
 *     LLM edits live alongside human peers. The server doesn't
 *     manage the provider lifecycle — that's the caller's job (so
 *     the same setup works in dev with one provider library and
 *     prod with another).
 *
 * # Returns
 *
 * The server instance + the underlying `HeadlessSobree`. The MCP
 * transport (stdio, SSE, HTTP) is the caller's choice — `connect()`
 * the server to whichever they want. The CLI in
 * `bin/sobree-mcp.ts` ships a stdio default.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { HeadlessSobree, type HeadlessSobreeOptions, type SobreeDocument } from "@sobree/core";
import * as Y from "yjs";
import { ALL_TOOLS, findTool } from "./tools";

export interface CreateSobreeMcpServerOptions {
  /**
   * Y.Doc the server's HeadlessSobree should attach to. Pass one
   * with a provider (y-websocket etc.) already wired for collab
   * mode; pass none for local mode (the server creates its own
   * empty Y.Doc).
   */
  ydoc?: Y.Doc;
  /**
   * Initial document. Used only in local mode (when no `ydoc` is
   * supplied OR the supplied ydoc is empty). Same semantics as
   * `HeadlessSobree.initialDocument`.
   */
  initialDocument?: SobreeDocument;
  /**
   * Origin tag for this peer's mutations. Default `"mcp"`.
   * Visible to other peers via Y transaction origin; useful for
   * post-hoc telemetry ("which edits came from the LLM").
   */
  origin?: string;
  /**
   * Override the package's identity reported to the MCP client.
   * Defaults are usually fine.
   */
  serverInfo?: { name?: string; version?: string };
  /**
   * Pass-through to `HeadlessSobree`'s constructor. Use this for
   * the rare option not exposed at the top level.
   */
  headlessOptions?: Omit<HeadlessSobreeOptions, "initialDocument" | "origin">;
}

export interface SobreeMcpServer {
  /** The underlying MCP server. Wire your transport with
   *  `await server.connect(transport)`. */
  readonly server: Server;
  /** The HeadlessSobree peer the tools mutate. Read it for tests
   *  or to drive non-MCP-mediated edits. */
  readonly sobree: HeadlessSobree;
  /** Tear down the headless peer + clear MCP state. The Y.Doc
   *  itself is the caller's to dispose. */
  destroy(): void;
}

const DEFAULT_NAME = "sobree";
const DEFAULT_VERSION = "0.1.0";

export function createSobreeMcpServer(opts: CreateSobreeMcpServerOptions = {}): SobreeMcpServer {
  const ydoc = opts.ydoc ?? new Y.Doc();
  const sobree = new HeadlessSobree(ydoc, {
    origin: opts.origin ?? "mcp",
    ...(opts.initialDocument ? { initialDocument: opts.initialDocument } : {}),
    ...opts.headlessOptions,
  });

  const server = new Server(
    {
      name: opts.serverInfo?.name ?? DEFAULT_NAME,
      version: opts.serverInfo?.version ?? DEFAULT_VERSION,
    },
    { capabilities: { tools: {} } },
  );

  // tools/list — return the static tool catalog. Names + schemas
  // come from the registry in `tools.ts`.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  // tools/call — dispatch to the named handler. Errors are caught
  // and returned as content with `isError: true` per MCP spec, so
  // the LLM gets actionable feedback (e.g. "blockId not found —
  // call get_document").
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = findTool(name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `unknown tool: ${name}` }],
        isError: true,
      };
    }
    try {
      const result = await tool.handler(sobree, (args ?? {}) as never);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: msg }],
        isError: true,
      };
    }
  });

  return {
    server,
    sobree,
    destroy(): void {
      sobree.destroy();
    },
  };
}
