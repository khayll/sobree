import type { Block, InlineRun, Paragraph, SobreeDocument, Table } from "./types";

/**
 * Visitor pattern over the document tree.
 *
 * Every visitor key is optional — implement only the nodes you care about.
 * Return `false` from any handler to skip descending into children of that
 * node; return anything else (or omit the return) to continue.
 *
 * Why not exhaustive? Because the AST will gain shapes over time (comments,
 * tracked changes, equations) and existing visitors shouldn't break when we
 * add a new node kind. Skipped nodes log nothing — silent traversal.
 */
export interface DocVisitor {
  document?: (doc: SobreeDocument) => void | false;
  block?: (block: Block) => void | false;
  paragraph?: (p: Paragraph) => void | false;
  table?: (t: Table) => void | false;
  run?: (r: InlineRun) => void | false;
}

export function walk(doc: SobreeDocument, v: DocVisitor): void {
  if (v.document?.(doc) === false) return;
  for (const block of doc.body) walkBlock(block, v);
}

export function walkBlock(block: Block, v: DocVisitor): void {
  if (v.block?.(block) === false) return;
  if (block.kind === "paragraph") {
    if (v.paragraph?.(block) === false) return;
    for (const run of block.runs) walkRun(run, v);
  } else if (block.kind === "table") {
    if (v.table?.(block) === false) return;
    for (const row of block.rows) {
      for (const cell of row.cells) {
        for (const inner of cell.content) walkBlock(inner, v);
      }
    }
  }
  // section_break has no children to walk.
}

export function walkRun(run: InlineRun, v: DocVisitor): void {
  if (v.run?.(run) === false) return;
  if (run.kind === "hyperlink") {
    for (const child of run.children) walkRun(child, v);
  }
}

/**
 * Collect every text run's text into a single flat string. Useful for
 * search, outline extraction, and "give me the plain text" callers.
 */
export function plainText(doc: SobreeDocument): string {
  const parts: string[] = [];
  walk(doc, {
    paragraph: (p) => {
      parts.push(runsToText(p.runs));
    },
  });
  return parts.join("\n");
}

export function runsToText(runs: readonly InlineRun[]): string {
  let out = "";
  for (const run of runs) {
    if (run.kind === "text") out += run.text;
    else if (run.kind === "tab") out += "\t";
    else if (run.kind === "break") out += "\n";
    else if (run.kind === "field" && run.cached) out += run.cached;
    else if (run.kind === "hyperlink") out += runsToText(run.children);
  }
  return out;
}

/** Derive the heading level from a paragraph's styleId, if any. */
export function headingLevelOf(p: Paragraph): number | null {
  const id = p.properties.styleId;
  if (!id) return null;
  const m = id.match(/^Heading(\d)$/);
  if (!m?.[1]) return null;
  const lv = Number(m[1]);
  return lv >= 1 && lv <= 6 ? lv : null;
}
