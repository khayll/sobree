/**
 * Tool definitions for the Sobree MCP server.
 *
 * Each tool maps a Model Context Protocol invocation to a
 * `HeadlessSobree` mutation or read. Inputs are JSON Schema; outputs
 * are JSON-serialisable. The MCP transport layer (stdio, SSE, etc.)
 * is decoupled — these handlers are pure (input → output, plus side
 * effects on the supplied `HeadlessSobree`).
 *
 * The catalog is split by capability under `tools/` so read, block,
 * formatting, and history changes stay isolated while this module
 * preserves the original import path.
 */
export * from "./tools/index";
