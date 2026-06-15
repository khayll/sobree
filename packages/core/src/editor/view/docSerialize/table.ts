import type { ParagraphAlignment, Table, TableCell, TableRow } from "../../../doc/types";
import { serializeInlineChildren } from "./inline";

/**
 * Convert a `<table>` back into a Table AST node.
 *
 * The AST mirrors OOXML's row/cell model: every visual cell, including
 * cells occluded by a vertical merge above them, is represented as its
 * own `TableCell` (with `vMerge: "continue"` for the occluded ones and
 * `vMerge: "restart"` on the cell that spans them). The DOM's
 * `rowspan` attribute collapses multiple rows into a single `<td>`; we
 * synthesize the continuation cells back here.
 */
export function tableFromElement(el: HTMLElement): Table {
  const domRows = Array.from(
    el.querySelectorAll<HTMLTableRowElement>(":scope > thead > tr, :scope > tbody > tr"),
  );
  const pending = new Map<number, number>();
  const rows: TableRow[] = [];

  for (const tr of domRows) {
    rows.push(rowFromElement(tr, pending));
  }

  const colCount = rows.reduce((n, r) => Math.max(n, countColumns(r.cells)), 0);
  return {
    kind: "table",
    grid: Array.from({ length: colCount }, () => 2400),
    rows,
    properties: {},
  };
}

function rowFromElement(tr: HTMLTableRowElement, pending: Map<number, number>): TableRow {
  const cellEls = Array.from(tr.querySelectorAll<HTMLTableCellElement>(":scope > th, :scope > td"));
  const isHeader = tr.parentElement?.tagName.toLowerCase() === "thead";
  const cells: TableCell[] = [];

  let col = 0;
  let domIdx = 0;
  // Keep going while there's either DOM cells left to place or a pending
  // vertical-merge continuation still owed to this row.
  while (domIdx < cellEls.length || pending.get(col)) {
    const pendingHere = pending.get(col) ?? 0;
    if (pendingHere > 0) {
      cells.push(makeContinueCell());
      pending.set(col, pendingHere - 1);
      col += 1;
      continue;
    }
    const el = cellEls[domIdx++];
    if (!el) break;
    const gridSpan = readSpan(el.getAttribute("colspan"));
    const rowSpan = readSpan(el.getAttribute("rowspan"));
    const cell = cellFromElement(el);
    if (gridSpan > 1) cell.gridSpan = gridSpan;
    if (rowSpan > 1) {
      cell.vMerge = "restart";
      for (let i = 0; i < gridSpan; i++) pending.set(col + i, rowSpan - 1);
    }
    cells.push(cell);
    col += gridSpan;
  }

  const row: TableRow = { cells };
  if (isHeader) row.isHeader = true;
  return row;
}

function cellFromElement(c: HTMLTableCellElement): TableCell {
  const alignment = parseAlignment(c.style.textAlign);
  const props = alignment ? { alignment } : {};

  // Two cell-rendering modes coexist in the wild:
  //
  //   1. Modern (post the table-cell paragraph cascade fix): the cell
  //      contains real `<p>` / `<ol>` / `<ul>` / `<table>` children,
  //      each carrying its own paragraph properties.
  //   2. Legacy (pre-fix, also any hand-edit / paste case): the cell
  //      contains inline nodes interspersed with `<br>` elements; the
  //      <br> separators stand in for paragraph boundaries.
  //
  // Detect mode 1 by looking for any block-level child; otherwise fall
  // through to mode 2's <br>-splitter so backward-compat content (and
  // freshly-pasted text) keeps round-tripping.
  const hasBlockChildren = Array.from(c.children).some((child) => {
    const tag = child.tagName;
    return tag === "P" || tag === "OL" || tag === "UL" || tag === "TABLE";
  });

  const content: TableCell["content"] = [];
  if (hasBlockChildren) {
    for (const child of Array.from(c.children) as HTMLElement[]) {
      const tag = child.tagName;
      if (tag === "P") {
        const childAlign = parseAlignment(child.style.textAlign) ?? alignment;
        content.push({
          kind: "paragraph",
          properties: childAlign ? { alignment: childAlign } : {},
          runs: serializeInlineChildren(child),
        });
      } else if (tag === "OL" || tag === "UL") {
        for (const li of Array.from(child.children)) {
          content.push({
            kind: "paragraph",
            properties: alignment ? { alignment } : {},
            runs: serializeInlineChildren(li as HTMLElement),
          });
        }
      }
      // Nested tables in cells are a real OOXML feature but rare; we
      // skip them at serialize time for now (they'd round-trip lossily
      // until we plumb full table-in-cell support).
    }
  } else {
    const chunks = splitOnBreaks(c);
    for (const nodes of chunks) {
      const scratch = document.createElement("span");
      for (const n of nodes) scratch.appendChild(n.cloneNode(true));
      content.push({
        kind: "paragraph",
        properties: { ...props },
        runs: serializeInlineChildren(scratch),
      });
    }
  }

  if (content.length === 0) {
    content.push({ kind: "paragraph", properties: { ...props }, runs: [] });
  }
  return { content };
}

function splitOnBreaks(el: HTMLElement): Node[][] {
  const groups: Node[][] = [[]];
  for (const node of Array.from(el.childNodes)) {
    if (node instanceof HTMLBRElement) {
      groups.push([]);
      continue;
    }
    groups[groups.length - 1]!.push(node);
  }
  // Drop trailing empty group (cell ending in `<br>`).
  if (groups[groups.length - 1]?.length === 0 && groups.length > 1) groups.pop();
  return groups;
}

function makeContinueCell(): TableCell {
  return {
    vMerge: "continue",
    content: [{ kind: "paragraph", properties: {}, runs: [] }],
  };
}

function countColumns(cells: readonly TableCell[]): number {
  let n = 0;
  for (const c of cells) n += c.gridSpan ?? 1;
  return n;
}

function readSpan(attr: string | null): number {
  if (!attr) return 1;
  const n = Number(attr);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function parseAlignment(v: string): ParagraphAlignment | undefined {
  const s = v.trim().toLowerCase();
  if (s === "left" || s === "right" || s === "center") return s;
  if (s === "justify") return "both";
  return undefined;
}
