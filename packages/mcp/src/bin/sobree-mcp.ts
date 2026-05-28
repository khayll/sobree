#!/usr/bin/env node
/**
 * `sobree-mcp` — stdio MCP server entry point.
 *
 * # Usage
 *
 * ```sh
 * # Local mode — LLM edits its own ephemeral Sobree doc.
 * npx @sobree/mcp
 *
 * # Collab mode — connect to a running @sobree/collab-server.
 * npx @sobree/mcp --ws-url ws://localhost:1234 --room doc-123
 * ```
 *
 * # Wiring into Claude Desktop
 *
 * Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
 *
 * ```json
 * {
 *   "mcpServers": {
 *     "sobree": {
 *       "command": "npx",
 *       "args": ["-y", "@sobree/mcp", "--ws-url", "ws://localhost:1234", "--room", "demo"]
 *     }
 *   }
 * }
 * ```
 *
 * Restart Claude Desktop. The model will see the Sobree tools listed
 * in its tool palette.
 *
 * # Flags
 *
 *   --ws-url <url>    WebSocket URL of a running @sobree/collab-server.
 *                      When set, the server connects to that room and
 *                      edits propagate to other peers.
 *   --room <id>       Room id to join (required with --ws-url).
 *   --origin <name>   Origin tag for this peer's mutations (default: "mcp").
 *   --help            Print usage and exit.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as Y from "yjs";
import { createSobreeMcpServer } from "../server";

interface Args {
  wsUrl?: string;
  room?: string;
  origin?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const ydoc = new Y.Doc();

  // Optional collab mode — attach a y-websocket provider so this
  // peer's edits propagate to other clients in the same room.
  let provider: { destroy(): void; once(ev: string, cb: () => void): void } | null = null;
  if (args.wsUrl) {
    if (!args.room) {
      die("--room is required when --ws-url is set");
    }
    try {
      const yws = await import(/* @vite-ignore */ "y-websocket");
      const Provider = (yws as { WebsocketProvider: unknown })
        .WebsocketProvider as new (
        url: string,
        room: string,
        doc: Y.Doc,
      ) => {
        destroy(): void;
        once(ev: string, cb: () => void): void;
      };
      provider = new Provider(args.wsUrl, args.room, ydoc);
      // Wait briefly for initial sync so the LLM's first
      // get_document call returns hydrated state.
      await Promise.race([
        new Promise<void>((resolve) => provider?.once("sync", resolve)),
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]);
      log(`connected to ${args.wsUrl}/${args.room}`);
    } catch (err) {
      die(
        `failed to load y-websocket. Install it: pnpm add y-websocket. Original error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  } else {
    log("local mode (no --ws-url) — Y.Doc is ephemeral");
  }

  const sobreeOpts: Parameters<typeof createSobreeMcpServer>[0] = { ydoc };
  if (args.origin) sobreeOpts.origin = args.origin;
  const { server, destroy } = createSobreeMcpServer(sobreeOpts);

  // Stdio transport — Claude Desktop and most MCP clients speak
  // this. The server reads JSON-RPC messages from stdin and writes
  // responses to stdout. Logging goes to stderr so it doesn't
  // corrupt the protocol stream.
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log("ready");

  // Graceful shutdown.
  const shutdown = async () => {
    try {
      destroy();
      provider?.destroy();
      ydoc.destroy();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

function parseArgs(argv: readonly string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg === "--ws-url") {
      const v = argv[++i];
      if (v) out.wsUrl = v;
    } else if (arg === "--room") {
      const v = argv[++i];
      if (v) out.room = v;
    } else if (arg === "--origin") {
      const v = argv[++i];
      if (v) out.origin = v;
    } else {
      die(`unknown argument: ${arg}`);
    }
  }
  return out;
}

function printUsage(): void {
  process.stderr.write(`sobree-mcp — Sobree MCP server (stdio transport)

Usage:
  sobree-mcp                              # local mode (ephemeral Y.Doc)
  sobree-mcp --ws-url <url> --room <id>   # collab mode (join a @sobree/collab-server room)

Options:
  --ws-url <url>    WebSocket URL of a @sobree/collab-server
  --room <id>       Room id to join (required with --ws-url)
  --origin <name>   Origin tag for this peer's mutations (default: "mcp")
  --help, -h        Print this message
`);
}

function log(msg: string): void {
  process.stderr.write(`[sobree-mcp] ${msg}\n`);
}

function die(msg: string): never {
  process.stderr.write(`[sobree-mcp] error: ${msg}\n`);
  process.exit(1);
}

main().catch((err) => {
  die(err instanceof Error ? err.message : String(err));
});
