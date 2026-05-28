---
title: "@sobree/mcp"
description: MCP server for Sobree — let LLMs read and edit a document via standardized tools.
---

`@sobree/mcp` is a Model Context Protocol server that lets an LLM
(Claude Desktop, Anthropic API tool-use, any MCP client) read and
edit a Sobree document. Internally it wraps
[`HeadlessSobree`](/api/headless/) — the no-DOM peer — so all the
same Y.Doc / per-peer-undo / collab guarantees apply.

## When to use it

- **You want the LLM to dictate / draft / restructure a document.**
  Run the server in local mode and let Claude (or any MCP client)
  produce content directly into a Sobree-shaped doc.
- **You want a "Cursor for documents" pattern.** Run the server
  alongside a human-edited Sobree doc (collab mode); the LLM and
  the human edit live in the same room. Per-peer undo means
  neither can clobber the other.
- **You want LLM-driven automation in a back-end pipeline.**
  Trigger Claude with a doc, let it apply structured edits via the
  MCP tools, save the result.

## Install

```sh
pnpm add @sobree/mcp
# or globally for the CLI:
pnpm add -g @sobree/mcp
```

## CLI

```sh
# Local mode — LLM edits its own ephemeral document.
sobree-mcp

# Collab mode — connect to a running @sobree/collab-server.
sobree-mcp --ws-url ws://localhost:1234 --room demo
```

`stdio` is the default transport — Claude Desktop and most MCP
clients speak this. The server reads JSON-RPC from stdin, writes
responses to stdout. All logging goes to stderr so it doesn't
corrupt the protocol stream.

## Wiring into Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or the equivalent on your platform:

```json
{
  "mcpServers": {
    "sobree": {
      "command": "npx",
      "args": ["-y", "@sobree/mcp", "--ws-url", "ws://localhost:1234", "--room", "demo"]
    }
  }
}
```

Restart Claude. The model sees Sobree's tools in its tool palette and
can read / mutate the document by calling them.

For the "edit alongside a human" pattern:

1. Run `pnpm dev:collab` from the Sobree repo (or any
   `@sobree/collab-server` instance).
2. Open the playground at `http://localhost:5174?mode=collab&room=demo`
   in your browser — that's the human's editor.
3. Configure Claude Desktop as above pointing at the same room.
4. Both peers — you and Claude — edit the same doc in real time.

## As a library

```ts
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSobreeMcpServer } from "@sobree/mcp";

const ydoc = new Y.Doc();
new WebsocketProvider("ws://localhost:1234", "doc-123", ydoc);

const { server, sobree } = createSobreeMcpServer({ ydoc, origin: "agent" });

const transport = new StdioServerTransport();
await server.connect(transport);

// Subscribe to changes from the human (or other peers)
sobree.on("change", ({ doc, local }) => {
  if (!local) console.log("human typed; new state:", doc.body.length);
});
```

`createSobreeMcpServer({ ydoc, ... })` returns:

```ts
interface SobreeMcpServer {
  readonly server: Server;        // MCP server — connect a transport
  readonly sobree: HeadlessSobree; // the underlying peer (read for tests / non-MCP work)
  destroy(): void;
}
```

## Tool catalog

```ts
get_document(): { blocks: Array<{ id, kind, text, length, ... }> }

get_outline(): { headings: Array<{ level, text, blockId }> }

insert_paragraph_after({ afterBlockId, text }): { blockId }
insert_paragraph_before({ beforeBlockId, text }): { blockId }
replace_paragraph({ blockId, text }): { blockId }
delete_block({ blockId }): { deleted }
set_paragraph_alignment({ blockId, alignment }): { blockId }

undo(): { undone: boolean }
redo(): { redone: boolean }
```

Errors come back as `{ isError: true, content: [{ type: "text", text: "..." }] }` —
the message is human-readable so the LLM can recover (e.g.
`"blockId not found. Call get_document to refresh."`).

## Per-peer undo

`Y.UndoManager.trackedOrigins` is scoped to this peer's `origin`
(default `"mcp"`). The `undo` tool reverses **only edits this peer
made** — the human's parallel edits flow through but never end up
on the LLM's undo stack. Result: the LLM's "regret last paragraph"
is clean even when the human typed in between.

## Current limitations

The server exposes a focused tool set: `get_document`, `get_outline`,
`insert_paragraph_after`, `insert_paragraph_before`,
`replace_paragraph`, `delete_block`, `set_paragraph_alignment`,
`undo`, and `redo`. Beyond that surface:

- **Formatted runs.** `replace_paragraph` takes plain text. To produce
  bold / italic / colored text, use the lower-level `editor.commands`
  directly; there is no MCP tool for run-level formatting.
- **Image / font insertion.** The headless peer doesn't surface
  those mutations, so no MCP tool covers them.
- **Table editing.** Read-only via `get_document` (tables appear as
  block summaries); structural edits to tables require dropping to
  `HeadlessSobree.replaceBlock` directly.
- **Streaming results.** Tool calls are request-response. Streaming
  drafts (where the LLM produces text token-by-token) would need a
  separate streaming-tool design.

## Related

- [HeadlessSobree](/api/headless/) — the underlying no-DOM peer
- [`@sobree/collab-server`](/api/collab-server/) — what to connect via `--ws-url`
- [Architecture: deployment tiers](/concepts/architecture/#deployment-tiers)
