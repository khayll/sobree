# @sobree/mcp

MCP (Model Context Protocol) server for Sobree.

→ Docs: **[docs.sobree.dev/api/mcp](https://docs.sobree.dev/api/mcp/)**

Lets an LLM (Claude Desktop, Anthropic API tool-use, any MCP-aware
client) read and edit a Sobree document via standardized tool calls.
Internally wraps `HeadlessSobree`, so the same Y.Doc + UndoManager +
per-peer-undo guarantees apply: the LLM's `Cmd+Z`-equivalent reverses
only its own edits, never the human's.

## Install

```sh
pnpm add @sobree/mcp
# or globally so the binary is on PATH:
pnpm add -g @sobree/mcp
```

## CLI

```sh
# Local mode — LLM edits its own ephemeral document.
sobree-mcp

# Collab mode — connect to a running @sobree/collab-server.
# The LLM edits live alongside human peers.
sobree-mcp --ws-url ws://localhost:1234 --room demo
```

### Wiring into Claude Desktop

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

Restart Claude. The model will see Sobree's tools in its tool palette
and can read / mutate the document by calling them.

For the "edit alongside a human" pattern: run
[`@sobree/collab-server`](https://docs.sobree.dev/api/collab-server/)
locally, point your browser editor at it (`?mode=collab` in the
playground), and configure Claude as above with the same room id.
Both peers see each other's edits in real time.

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

// Optional: do non-MCP-mediated work via `sobree`
sobree.on("change", ({ doc, local }) => {
  if (!local) console.log("human typed; new state:", doc.body.length, "blocks");
});
```

## Tools

| name                          | description                                                   |
| ----------------------------- | ------------------------------------------------------------- |
| `get_document`                | Read all blocks (id, kind, plain text preview, length).        |
| `get_outline`                 | Read the heading outline.                                     |
| `insert_paragraph_after`      | Insert a new plain-text paragraph after a block.              |
| `insert_paragraph_before`     | Insert a new plain-text paragraph before a block.             |
| `replace_paragraph`           | Replace a paragraph's content with new plain text.            |
| `delete_block`                | Delete a block by id.                                         |
| `set_paragraph_alignment`     | Set alignment (left / center / right / both / distribute).    |
| `undo`                        | Reverse the last LLM-made edit (per-peer undo).               |
| `redo`                        | Re-apply the most recently undone LLM edit.                   |

The tool surface is intentionally small for v0. Future versions add
formatted runs (bold, color, headings), images, tables, and richer
structural ops.

## Per-peer undo

Y.UndoManager's `trackedOrigins` is set to this peer's origin
(default `"mcp"`). The `undo` tool reverses **only edits this peer
made** — the human's parallel edits flow through but never end up on
the LLM's undo stack. So if the LLM regrets a paragraph it added,
calling `undo` removes that paragraph cleanly without touching what
the human did meanwhile.

## License

MIT.
