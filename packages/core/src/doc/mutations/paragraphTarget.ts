import type { InlinePosition } from "../api";
import type { Block, Paragraph, SobreeDocument, Table } from "../types";
import type { BlockRegistryView } from "./types";

/**
 * The paragraph an {@link InlinePosition} addresses, plus how to write a new
 * version of it back into the document.
 *
 * A position is either a BODY paragraph (`at.cell` absent) or a paragraph
 * inside a table cell (`at.cell` present). Both resolve to "one paragraph to
 * read, one top-level block index to bump" — for a cell position the block to
 * bump is the TABLE, since cell content is not registry-tracked and rides on
 * its table's version. That's what lets cell edits reuse the whole ref /
 * version / commit model unchanged.
 */
export interface ParagraphTarget {
  /** The addressed paragraph. */
  paragraph: Paragraph;
  /** Body index of the top-level block to bump (the table, for a cell). */
  index: number;
  /** A new `doc.body` with `next` written back in the paragraph's place. */
  withParagraph(next: Paragraph): Block[];
  /**
   * A new `doc.body` with the addressed paragraph replaced by `next` — one
   * block or several.
   *
   * `null` for a BODY paragraph: changing how many blocks the body holds has
   * to go through the block ops so the registry learns their ids. Inside a
   * cell there's nothing to tell — the content isn't registry-tracked and
   * rides the table's version — so the table bump covers it.
   */
  withBlocks(next: readonly Block[]): Block[] | null;
}

/**
 * Resolve `at` to the paragraph it addresses, or `null` when the ops cannot
 * act there — callers must then DECLINE the edit and leave it to the native
 * path rather than consume and drop it.
 *
 * `null` covers: a non-paragraph target, a cell address that doesn't resolve,
 * and cells whose content is not addressable by index (see
 * {@link cellContentIsAddressable}).
 */
export function paragraphTargetAt(
  doc: SobreeDocument,
  registry: BlockRegistryView,
  at: InlinePosition,
): ParagraphTarget | null {
  const index = registry.indexOf(at.block.id);
  const block = doc.body[index];
  if (!block) return null;

  if (!at.cell) {
    if (block.kind !== "paragraph") return null;
    const paragraph = block;
    return {
      paragraph,
      index,
      withParagraph: (next) => {
        const body = doc.body.slice();
        body[index] = next;
        return body;
      },
      withBlocks: () => null,
    };
  }

  if (block.kind !== "table") return null;
  const { row: rowIndex, col: colIndex, blockIndex } = at.cell;
  const row = block.rows[rowIndex];
  const cell = row?.cells[colIndex];
  if (!row || !cell) return null;
  if (!cellContentIsAddressable(cell.content)) return null;
  const paragraph = cell.content[blockIndex];
  if (paragraph?.kind !== "paragraph") return null;

  /** Rebuild the document with the cell's content blocks replaced wholesale. */
  const withCellContent = (content: readonly Block[]): Block[] => {
    const cells = row.cells.slice();
    cells[colIndex] = { ...cell, content: content.slice() };
    const rows = block.rows.slice();
    rows[rowIndex] = { ...row, cells };
    const table: Table = { ...block, rows };
    const body = doc.body.slice();
    body[index] = table;
    return body;
  };

  /** The cell's content with the addressed paragraph replaced by `next`. */
  const contentWith = (next: readonly Block[]): Block[] => {
    const content = cell.content.slice();
    content.splice(blockIndex, 1, ...next);
    return content;
  };

  return {
    paragraph,
    index,
    withParagraph: (next) => withCellContent(contentWith([next])),
    withBlocks: (next) => withCellContent(contentWith(next)),
  };
}

/**
 * Whether a cell's content blocks map 1:1 onto the elements rendered inside
 * its `<td>`, which is what makes `cell.blockIndex` (a rendered-child index)
 * a valid index into `cell.content`.
 *
 * True only when every block is a NON-NUMBERED paragraph. `renderBlocks`
 * groups consecutive numbered paragraphs into a single `<ul>`/`<ol>`, so a
 * cell holding a list renders fewer children than it has blocks and every
 * index past the list points at the wrong paragraph; a nested table is
 * likewise not a paragraph. Rather than re-derive the renderer's grouping
 * here — a second owner of it, and the exact class of bug this addressing
 * work exists to kill — such cells are simply not addressable, and the ops
 * decline them.
 */
function cellContentIsAddressable(content: readonly Block[]): boolean {
  return content.every((b) => b.kind === "paragraph" && b.properties.numbering === undefined);
}
