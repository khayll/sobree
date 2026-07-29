/**
 * Block-level bookmark markers — `<w:bookmarkStart>`/`<w:bookmarkEnd>`
 * appearing as DIRECT children of a block container (`w:body`, `w:tc`),
 * not inside any paragraph. Word writes TOC targets this way when the
 * bookmark opens before the first paragraph (observed: four `_Toc`
 * starts as the first body children of a real report), and `_GoBack`
 * lands at cell level.
 *
 * The AST models markers as inline runs, so the importer NORMALIZES
 * block-level markers into the nearest paragraph:
 *   - a start attaches to the FRONT of the next paragraph (the bookmark
 *     covers the content that follows);
 *   - an end appends to the END of the previous paragraph (it closes
 *     the content before it) — unless a start is still pending, in
 *     which case it stays with it so a zero-length pair (`_GoBack`)
 *     lands adjacent;
 *   - markers pending when a TABLE arrives attach to the table's first
 *     paragraph in reading order (the faithful page position);
 *   - markers still pending at container end append to the last
 *     paragraph.
 * Export emits them inside the host paragraph, and the second import
 * reads them from there — so the fixpoint holds after one normalizing
 * import.
 */

import type { Block, InlineRun, Paragraph, Table } from "../../doc/types";
import { NS } from "../shared/namespaces";

type Marker = Extract<InlineRun, { kind: "bookmarkStart" | "bookmarkEnd" }>;

export class BlockMarkerBuffer {
  private pending: Marker[] = [];

  /** Consume a container child if it is a block-level marker. */
  handle(child: Element, blocks: Block[]): boolean {
    if (child.namespaceURI !== NS.w) return false;
    if (child.localName === "bookmarkStart") {
      const id = Number(child.getAttributeNS(NS.w, "id") ?? child.getAttribute("w:id"));
      const name = child.getAttributeNS(NS.w, "name") ?? child.getAttribute("w:name");
      if (Number.isFinite(id) && name !== null) {
        this.pending.push({ kind: "bookmarkStart", id, name });
      }
      return true;
    }
    if (child.localName === "bookmarkEnd") {
      const id = Number(child.getAttributeNS(NS.w, "id") ?? child.getAttribute("w:id"));
      if (Number.isFinite(id)) {
        const end: Marker = { kind: "bookmarkEnd", id };
        const prev = blocks[blocks.length - 1];
        if (this.pending.length === 0 && prev?.kind === "paragraph") prev.runs.push(end);
        else this.pending.push(end);
      }
      return true;
    }
    return false;
  }

  /** Call after pushing a block: pending markers attach to it if it can host them. */
  afterBlockPushed(blocks: Block[]): void {
    if (this.pending.length === 0) return;
    const host = blocks[blocks.length - 1];
    const target =
      host?.kind === "paragraph"
        ? host
        : host?.kind === "table"
          ? firstParagraphOf(host)
          : undefined;
    if (!target) return;
    target.runs.unshift(...this.pending);
    this.pending = [];
  }

  /** Container end: whatever is still pending appends to the last paragraph. */
  finish(blocks: Block[]): void {
    if (this.pending.length === 0) return;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b?.kind === "paragraph") {
        b.runs.push(...this.pending);
        this.pending = [];
        return;
      }
    }
    // No paragraph in the whole container — nothing can host the marker.
    this.pending = [];
  }
}

/** First paragraph of a table in reading order (descending into nested tables). */
function firstParagraphOf(t: Table): Paragraph | undefined {
  for (const row of t.rows) {
    for (const cell of row.cells) {
      for (const b of cell.content) {
        if (b.kind === "paragraph") return b;
        if (b.kind === "table") {
          const inner = firstParagraphOf(b);
          if (inner) return inner;
        }
      }
    }
  }
  return undefined;
}
