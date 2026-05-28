/**
 * End-to-end MCP server tests.
 *
 * Pairs an MCP `Client` with our `createSobreeMcpServer()` over an
 * in-memory transport — same wire path as a real Claude Desktop
 * client connecting via stdio, just without the process boundary.
 *
 * Verifies:
 *   - tools/list returns the catalog
 *   - tools/call routes to the right handler and returns content
 *   - errors come back as `isError: true` with a useful message
 *   - mutations actually mutate the underlying Y.Doc
 *   - history (undo) round-trips through the protocol
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendBlock,
  emptyDocument,
  paragraph,
  text,
} from "@sobree/core";
import { createSobreeMcpServer, type SobreeMcpServer } from "./server";

describe("@sobree/mcp — e2e via InMemoryTransport", () => {
  let client: Client;
  let mcp: SobreeMcpServer;

  beforeEach(async () => {
    const ydoc = new Y.Doc();
    const initial = emptyDocument();
    appendBlock(initial, paragraph([text("hello")]));
    appendBlock(initial, paragraph([text("world")]));

    mcp = createSobreeMcpServer({ ydoc, initialDocument: initial });

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await mcp.server.connect(serverTransport);

    client = new Client(
      { name: "test-client", version: "0.0.0" },
      { capabilities: {} },
    );
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    mcp.destroy();
  });

  it("lists every Sobree tool", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toContain("get_document");
    expect(names).toContain("get_outline");
    expect(names).toContain("insert_paragraph_after");
    expect(names).toContain("replace_paragraph");
    expect(names).toContain("delete_block");
    expect(names).toContain("undo");
  });

  it("get_document returns a JSON-encoded block list", async () => {
    const result = await client.callTool({
      name: "get_document",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.type).toBe("text");
    const parsed = JSON.parse(content[0]!.text) as {
      blocks: Array<{ id: string; text: string }>;
    };
    expect(parsed.blocks.length).toBeGreaterThanOrEqual(2);
    expect(parsed.blocks.some((b) => b.text === "hello")).toBe(true);
  });

  it("insert_paragraph_after mutates the underlying Y.Doc", async () => {
    const before = mcp.sobree.getBlocks();
    const target = before[before.length - 1]!;
    const result = await client.callTool({
      name: "insert_paragraph_after",
      arguments: { afterBlockId: target.id, text: "added by LLM" },
    });
    expect(result.isError).not.toBe(true);
    const after = mcp.sobree.getBlocks();
    expect(after.length).toBe(before.length + 1);
    expect(after[after.length - 1]?.text).toBe("added by LLM");
  });

  it("replace_paragraph rewrites a block via the wire", async () => {
    const target = mcp.sobree.getBlock(1);
    await client.callTool({
      name: "replace_paragraph",
      arguments: { blockId: target.id, text: "rewritten" },
    });
    expect(mcp.sobree.getBlock(1).text).toBe("rewritten");
  });

  it("delete_block removes a block", async () => {
    const before = mcp.sobree.getBlocks();
    const target = before[1]!;
    await client.callTool({
      name: "delete_block",
      arguments: { blockId: target.id },
    });
    expect(mcp.sobree.getBlocks().length).toBe(before.length - 1);
  });

  it("undo + redo round-trip via the wire", async () => {
    const target = mcp.sobree.getBlock(1);
    await client.callTool({
      name: "replace_paragraph",
      arguments: { blockId: target.id, text: "edit" },
    });
    expect(mcp.sobree.getBlock(1).text).toBe("edit");

    await client.callTool({ name: "undo", arguments: {} });
    expect(mcp.sobree.getBlock(1).text).toBe("hello");

    await client.callTool({ name: "redo", arguments: {} });
    expect(mcp.sobree.getBlock(1).text).toBe("edit");
  });

  it("calling a non-existent tool returns isError:true", async () => {
    const result = await client.callTool({
      name: "no_such_tool",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toMatch(/unknown tool/i);
  });

  it("calling a mutation with a bad blockId returns isError with a hint", async () => {
    const result = await client.callTool({
      name: "replace_paragraph",
      arguments: { blockId: "nope", text: "x" },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toMatch(/not found/i);
  });
});
