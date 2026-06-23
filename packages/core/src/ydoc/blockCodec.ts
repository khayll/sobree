/**
 * Recursive block ↔ Y.Map codec — the single place that maps a
 * `SobreeDocument` block to/from its Y.Doc representation, at ANY depth.
 *
 * The same block-Y.Map shape is used at the top level (`body` array) and
 * nested inside composite blocks (a table cell's `content`, a frame
 * textbox's `body`). Three operations, all recursive:
 *
 *   - {@link buildBlockSkeleton} + {@link populateBlock} — AST → Y, two
 *     phase: skeleton builds the full nested STRUCTURE (Y.Arrays / Y.Maps /
 *     empty Y.Texts + all JSON); populate applies the text deltas, which
 *     requires the Y.Text to be integrated (so it runs after the root is
 *     inserted into an integrated parent).
 *   - {@link projectBlock} — Y → AST.
 *   - {@link updateBlockYMap} — diff an AST block into an existing integrated
 *     map (minimal Y ops; paragraph text via smart diff so concurrent
 *     char edits merge).
 *
 * Per-kind storage:
 *   - paragraph    → `text` Y.Text (char CRDT) + `props` JSON
 *   - table        → `grid`/`props` JSON + `rows` Y.Array (rows → cells →
 *                    each cell `props` JSON + `content` Y.Array<blockMap>).
 *                    Per-CELL props ⇒ concurrent styling of *different*
 *                    cells merges; cell text merges char-level.
 *   - section_break / inline_frame → `_ast` leaf (whole-block JSON)
 *
 * The `content` array helpers ({@link buildContent} / {@link projectContent}
 * / {@link updateContent}) are exported for reuse by the anchored-frame
 * meta restructuring, whose textbox bodies are the same `Block[]`.
 *
 * Nested content arrays diff POSITIONALLY (a cell holds ~one paragraph);
 * the top-level body stays id-matched (see `apply.ts`). Migration: a
 * pre-nesting table is a leaf `_ast`; {@link projectBlock} reads it via the
 * fallback, and {@link updateBlockYMap} rebuilds it nested on first edit.
 */

import * as Y from "yjs";
import type { Block, Paragraph, Table, TableCell, TableRow } from "../doc/types";
import { type DeltaOp, deltaToRuns, runsToDelta } from "./runs";
import {
  Y_BLOCK_AST_KEY,
  Y_BLOCK_ID_KEY,
  Y_BLOCK_KIND_KEY,
  Y_BLOCK_PROPS_KEY,
  Y_BLOCK_TEXT_KEY,
  Y_CELL_CONTENT_KEY,
  Y_ROW_CELLS_KEY,
  Y_TABLE_GRID_KEY,
  Y_TABLE_ROWS_KEY,
} from "./schema";
import { diffApplyText } from "./textDiff";

type YMap = Y.Map<unknown>;
type YArr = Y.Array<YMap>;

// === shape detection (structural — survives missing/legacy `kind`) ===

type Shape = "paragraph" | "table" | "leaf";

function currentShape(map: YMap): Shape {
  if (map.get(Y_BLOCK_TEXT_KEY) instanceof Y.Text) return "paragraph";
  if (map.get(Y_TABLE_ROWS_KEY) instanceof Y.Array) return "table";
  return "leaf";
}

function targetShape(block: Block): Shape {
  if (block.kind === "paragraph") return "paragraph";
  if (block.kind === "table") return "table";
  return "leaf";
}

// === small helpers ===

function parseJSON<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string") return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function setIfChanged(map: YMap, key: string, value: string): void {
  if (map.get(key) !== value) map.set(key, value);
}

// === build: AST → Y (phase 1, structure only) ===

/** Build a detached block Y.Map skeleton — full nested structure + JSON,
 *  empty Y.Texts. Call {@link populateBlock} after it's integrated. */
export function buildBlockSkeleton(id: string, block: Block): YMap {
  const m = new Y.Map<unknown>();
  m.set(Y_BLOCK_ID_KEY, id);
  setSkeletonKeys(m, block);
  return m;
}

/** Set a block's structural keys on `m` (which may be detached or already
 *  integrated). Creates child Y types but writes NO text deltas. */
function setSkeletonKeys(m: YMap, block: Block): void {
  if (block.kind === "paragraph") {
    m.set(Y_BLOCK_KIND_KEY, "paragraph");
    m.set(Y_BLOCK_PROPS_KEY, JSON.stringify(block.properties));
    m.set(Y_BLOCK_TEXT_KEY, new Y.Text());
    return;
  }
  if (block.kind === "table") {
    m.set(Y_BLOCK_KIND_KEY, "table");
    m.set(Y_TABLE_GRID_KEY, JSON.stringify(block.grid));
    m.set(Y_BLOCK_PROPS_KEY, JSON.stringify(block.properties));
    m.set(Y_TABLE_ROWS_KEY, buildRows(block.rows));
    return;
  }
  // section_break / inline_frame: opaque leaf.
  m.set(Y_BLOCK_KIND_KEY, block.kind);
  m.set(Y_BLOCK_AST_KEY, JSON.stringify(block));
}

function buildRows(rows: readonly TableRow[]): YArr {
  const arr = new Y.Array<YMap>();
  arr.push(rows.map(buildRow));
  return arr;
}

function buildRow(row: TableRow): YMap {
  const { cells, ...props } = row;
  const m = new Y.Map<unknown>();
  m.set(Y_BLOCK_PROPS_KEY, JSON.stringify(props));
  m.set(Y_ROW_CELLS_KEY, buildCells(cells));
  return m;
}

function buildCells(cells: readonly TableCell[]): YArr {
  const arr = new Y.Array<YMap>();
  arr.push(cells.map(buildCell));
  return arr;
}

function buildCell(cell: TableCell): YMap {
  const { content, ...props } = cell;
  const m = new Y.Map<unknown>();
  m.set(Y_BLOCK_PROPS_KEY, JSON.stringify(props));
  m.set(Y_CELL_CONTENT_KEY, buildContent(content));
  return m;
}

/** Build a detached `Y.Array` of block skeletons for a `Block[]` content
 *  list (cell content, frame body). Nested blocks have no stable id —
 *  matched positionally — so they carry an empty id. */
export function buildContent(blocks: readonly Block[]): YArr {
  const arr = new Y.Array<YMap>();
  arr.push(blocks.map((b) => buildBlockSkeleton("", b)));
  return arr;
}

// === populate: AST → Y (phase 2, text deltas; map must be integrated) ===

export function populateBlock(map: YMap, block: Block): void {
  if (block.kind === "paragraph") {
    applyParagraphText(map, block);
    return;
  }
  if (block.kind === "table") {
    const rows = map.get(Y_TABLE_ROWS_KEY) as YArr;
    block.rows.forEach((row, ri) => populateRow(rows.get(ri), row));
    return;
  }
  // leaf: all content already lives in the `_ast` string.
}

function populateRow(rowMap: YMap, row: TableRow): void {
  const cells = rowMap.get(Y_ROW_CELLS_KEY) as YArr;
  row.cells.forEach((cell, ci) =>
    populateContent(cells.get(ci).get(Y_CELL_CONTENT_KEY) as YArr, cell.content),
  );
}

/** Apply text deltas across an integrated content array. */
export function populateContent(arr: YArr, blocks: readonly Block[]): void {
  blocks.forEach((b, i) => populateBlock(arr.get(i), b));
}

function applyParagraphText(map: YMap, p: Paragraph): void {
  const text = map.get(Y_BLOCK_TEXT_KEY) as Y.Text;
  const delta = runsToDelta(p.runs);
  if (delta.length > 0) {
    text.applyDelta(delta as Array<{ insert: unknown; attributes?: object }>);
  }
}

// === project: Y → AST ===

export function projectBlock(map: YMap): Block | null {
  switch (currentShape(map)) {
    case "paragraph":
      return projectParagraph(map);
    case "table":
      return projectTable(map);
    default: {
      // Leaf / legacy / un-migrated composite: whole-block JSON.
      const ast = map.get(Y_BLOCK_AST_KEY);
      if (typeof ast !== "string") return null;
      try {
        return JSON.parse(ast) as Block;
      } catch {
        return null;
      }
    }
  }
}

function projectParagraph(map: YMap): Paragraph {
  const text = map.get(Y_BLOCK_TEXT_KEY) as Y.Text;
  const properties = parseJSON<Paragraph["properties"]>(map.get(Y_BLOCK_PROPS_KEY), {});
  return { kind: "paragraph", properties, runs: deltaToRuns(text.toDelta() as DeltaOp[]) };
}

function projectTable(map: YMap): Table {
  const grid = parseJSON<number[]>(map.get(Y_TABLE_GRID_KEY), []);
  const properties = parseJSON<Table["properties"]>(map.get(Y_BLOCK_PROPS_KEY), {});
  // Y.Array.map returns a plain Array (Y.Array isn't a for-of iterable).
  const rows = (map.get(Y_TABLE_ROWS_KEY) as YArr).map(projectRow);
  return { kind: "table", grid, properties, rows };
}

function projectRow(rowMap: YMap): TableRow {
  const props = parseJSON<Omit<TableRow, "cells">>(rowMap.get(Y_BLOCK_PROPS_KEY), {});
  const cells = (rowMap.get(Y_ROW_CELLS_KEY) as YArr).map(projectCell);
  return { ...props, cells };
}

function projectCell(cellMap: YMap): TableCell {
  const props = parseJSON<Omit<TableCell, "content">>(cellMap.get(Y_BLOCK_PROPS_KEY), {});
  const content = projectContent(cellMap.get(Y_CELL_CONTENT_KEY) as YArr);
  return { ...props, content };
}

export function projectContent(arr: YArr): Block[] {
  return arr.map(projectBlock).filter((b): b is Block => b !== null);
}

// === update: diff an AST block into an existing integrated map ===

export function updateBlockYMap(map: YMap, block: Block): void {
  if (currentShape(map) !== targetShape(block)) {
    rebuild(map, block);
    return;
  }
  if (block.kind === "paragraph") {
    updateParagraph(map, block);
    return;
  }
  if (block.kind === "table") {
    updateTable(map, block);
    return;
  }
  setIfChanged(map, Y_BLOCK_AST_KEY, JSON.stringify(block));
}

/** Wipe (keep id) + rebuild in the target shape. Loses Y identity — used on
 *  a kind change OR a one-time migration of a legacy `_ast` composite. */
function rebuild(map: YMap, block: Block): void {
  const id = map.get(Y_BLOCK_ID_KEY);
  for (const key of [...map.keys()]) {
    if (key !== Y_BLOCK_ID_KEY) map.delete(key);
  }
  setSkeletonKeys(map, block);
  populateBlock(map, block);
  if (!map.has(Y_BLOCK_ID_KEY) && typeof id === "string") map.set(Y_BLOCK_ID_KEY, id);
}

function updateParagraph(map: YMap, p: Paragraph): void {
  if (map.get(Y_BLOCK_KIND_KEY) !== "paragraph") map.set(Y_BLOCK_KIND_KEY, "paragraph");
  diffApplyText(map.get(Y_BLOCK_TEXT_KEY) as Y.Text, runsToDelta(p.runs));
  setIfChanged(map, Y_BLOCK_PROPS_KEY, JSON.stringify(p.properties));
}

function updateTable(map: YMap, table: Table): void {
  setIfChanged(map, Y_TABLE_GRID_KEY, JSON.stringify(table.grid));
  setIfChanged(map, Y_BLOCK_PROPS_KEY, JSON.stringify(table.properties));
  updateRows(map.get(Y_TABLE_ROWS_KEY) as YArr, table.rows);
}

function updateRows(arr: YArr, rows: readonly TableRow[]): void {
  rows.forEach((row, i) => {
    if (i < arr.length) {
      updateRow(arr.get(i), row);
    } else {
      const skel = buildRow(row);
      arr.insert(i, [skel]);
      populateRow(skel, row);
    }
  });
  while (arr.length > rows.length) arr.delete(arr.length - 1, 1);
}

function updateRow(rowMap: YMap, row: TableRow): void {
  const { cells, ...props } = row;
  setIfChanged(rowMap, Y_BLOCK_PROPS_KEY, JSON.stringify(props));
  updateCells(rowMap.get(Y_ROW_CELLS_KEY) as YArr, cells);
}

function updateCells(arr: YArr, cells: readonly TableCell[]): void {
  cells.forEach((cell, i) => {
    if (i < arr.length) {
      updateCell(arr.get(i), cell);
    } else {
      const skel = buildCell(cell);
      arr.insert(i, [skel]);
      populateContent(skel.get(Y_CELL_CONTENT_KEY) as YArr, cell.content);
    }
  });
  while (arr.length > cells.length) arr.delete(arr.length - 1, 1);
}

function updateCell(cellMap: YMap, cell: TableCell): void {
  const { content, ...props } = cell;
  setIfChanged(cellMap, Y_BLOCK_PROPS_KEY, JSON.stringify(props));
  updateContent(cellMap.get(Y_CELL_CONTENT_KEY) as YArr, content);
}

/** Diff a `Block[]` into an integrated content array (positional). */
export function updateContent(arr: YArr, blocks: readonly Block[]): void {
  blocks.forEach((b, i) => {
    if (i < arr.length) {
      updateBlockYMap(arr.get(i), b);
    } else {
      const skel = buildBlockSkeleton("", b);
      arr.insert(i, [skel]);
      populateBlock(skel, b);
    }
  });
  while (arr.length > blocks.length) arr.delete(arr.length - 1, 1);
}
