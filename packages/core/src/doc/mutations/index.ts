/**
 * Pure document mutation engine — the single source of truth for the
 * AST-level edits both Sobree peers perform.
 *
 * # Why this exists
 *
 * The browser `Editor` (DOM-backed) and `HeadlessSobree` (no-DOM peer for
 * LLM agents / MCP / automation) used to implement the same block,
 * paragraph, section, style, and numbering mutations independently. That
 * is silent-drift risk: change one path and the other — hence MCP, hence
 * every collaborating peer — keeps the old behavior, and Y.Doc parity or
 * block-version semantics diverge with nothing failing loudly. These
 * functions are that shared logic, called by both adapters.
 *
 * # The contract
 *
 * A mutation function is **pure**: given a {@link MutationInput} it returns
 * a {@link DocumentMutationResult} — a document patch plus the
 * registry-level {@link Mutation}s to apply — and nothing else.
 *
 * Strictly NO:
 *   - DOM / `HTMLElement` / selection APIs
 *   - `Y.Doc` / Yjs
 *   - renderer / paginator calls
 *   - command bus / plugin / editor-instance access
 *
 * The adapter owns commit, optimistic-lock application, Y.Doc mirroring,
 * history, rendering, and events. If a mutation seems to need any of the
 * above, the boundary is wrong — the engine should only know document
 * structure, block references, optimistic-lock metadata, and pure AST
 * transformations.
 */

export * from "./blocks";
export * from "./numbering";
export * from "./paragraphs";
export * from "./sections";
export * from "./styles";
export * from "./types";
