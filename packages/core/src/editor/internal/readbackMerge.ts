import type { Block, Paragraph, Table, TableCell, TableRow } from "../../doc/types";

/**
 * Merge a freshly DOM-serialised body into the previous AST body, preserving
 * everything the contentEditable DOM can't represent.
 *
 * The DOM is a LOSSY projection of the AST: it carries run text and inline
 * marks (bold, colour, font), but NOT block-level properties — paragraph
 * spacing / indent / borders, table style-id / look / cell margins,
 * section-break targets. A text edit changes a block's CONTENT, never those
 * properties, so re-deriving the whole AST from the DOM on every keystroke
 * silently strips them — the document degrades a little with each edit and
 * falls apart on the first re-render (undo / redo / remote).
 *
 * So we keep each previous block and overlay only the re-read content: runs
 * for a paragraph, cell content for a table. Properties survive.
 *
 * Matching a re-read block to its previous block is by stable id (the
 * renderer's `data-block-id`), resolved by the caller — so properties
 * survive structural edits too (Enter / Backspace / paste / reorder), not
 * just same-length typing. A re-read block with no prior match (a freshly
 * inserted block) keeps the DOM block as-is. Falls back to the DOM block
 * whenever kinds or nested shape diverge: structure is the one thing the
 * DOM IS authoritative about.
 */
export function mergeReadbackBlocks(
  next: readonly Block[],
  resolvePrev: (index: number) => Block | undefined,
): Block[] {
  return next.map((n, i) => mergeBlock(resolvePrev(i), n));
}

/** Positional convenience wrapper: match each block to `prev[i]`. */
export function mergeReadbackPreservingProps(
  prev: readonly Block[],
  next: readonly Block[],
): Block[] {
  return mergeReadbackBlocks(next, (i) => prev[i]);
}

function mergeBlock(prev: Block | undefined, next: Block): Block {
  if (!prev || prev.kind !== next.kind) return next;
  // Switch on `prev` so its type narrows; `next` shares the kind (checked above).
  switch (prev.kind) {
    case "paragraph":
      // Keep the paragraph's (DOM-lossy) properties; take the re-read runs —
      // text and inline marks, which the DOM DOES carry.
      return { ...prev, runs: (next as Paragraph).runs };
    case "table":
      return mergeTable(prev, next as Table);
    default:
      // section_break / inline_frame: the DOM carries nothing the AST needs
      // back through this path, so the previous block is authoritative.
      return prev;
  }
}

function mergeTable(prev: Table, next: Table): Block {
  if (prev.rows.length !== next.rows.length) return next;
  const rows: TableRow[] = next.rows.map((nr, r) => {
    const pr = prev.rows[r];
    if (!pr || pr.cells.length !== nr.cells.length) return pr ?? nr;
    const cells: TableCell[] = nr.cells.map((nc, c) => {
      const pc = pr.cells[c];
      if (!pc || pc.content.length !== nc.content.length) return pc ?? nc;
      return { ...pc, content: nc.content.map((nb, k) => mergeBlock(pc.content[k], nb)) };
    });
    return { ...pr, cells };
  });
  return { ...prev, rows };
}
