/**
 * Compatibility barrel for Sobree's document model.
 *
 * The model is split into concept-owned modules under `./types/` (one per
 * document concept: blocks, runs, paragraphs, tables, sections, styles,
 * numbering, drawing, …). This file preserves the historical
 * `doc/types` import path so every consumer keeps importing AST types from
 * one place — adding or moving a concept file never touches a caller.
 */
export type * from "./types/index";
