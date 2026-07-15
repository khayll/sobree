/**
 * Clipboard HTML → AST, for model-first rich paste (Phase 3-5 of
 * `devdocs/plan-model-first-editing.md`).
 *
 * The DOM→AST mapping is NOT reinvented here — `docSerialize` already owns it
 * (`blocksFromNodes` → paragraphs / headings / lists / tables via
 * `serializeInlineChildren`, which reads b/i/u/a/span[style]/… including
 * paste-from-Word wrappers). This module is the paste-specific ADAPTER over it:
 * foreign clipboard HTML nests blocks in wrapper `<div>`s and leaves loose
 * inline siblings between blocks, neither of which the flat read-back parser
 * groups. `flattenForPaste` normalises that into the flat block-element list
 * `blocksFromNodes` expects, then hands off.
 *
 * Output carries the `numbering` definitions the parsed lists allocated (numIds
 * local to the paste, starting at 1); the insertion step remaps them clear of
 * the target document's numbering.
 */

import type { Range as ApiRange, InlinePosition } from "../../doc/api";
import { stampInsertRevision } from "../../doc/mutations/revisions";
import { mergeAdjacentTextRuns, splitRunsAt } from "../../doc/runs";
import type {
  Block,
  InlineRun,
  NumberingDefinition,
  Paragraph,
  ParagraphProperties,
} from "../../doc/types";
import type { EditorContext } from "../context";
import * as query from "../query";
import { type BlockSerializeContext, blocksFromNodes } from "../view/docSerialize/block";
import { insertBlockAfter, replaceBlock } from "./blocks";
import { deleteRange } from "./runs";

/** Block tags `blocksFromNodes` maps directly — kept whole (not recursed). */
const MAPPED_BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "table",
  "blockquote",
  "hr",
  "pre",
]);

/** Generic containers that WRAP other blocks (Word/Google paste structure) —
 *  recurse into them when they hold block children, else treat as a paragraph. */
const GENERIC_CONTAINER_TAGS = new Set([
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "aside",
  "figure",
  "figcaption",
  "body",
  "dl",
  "dd",
  "dt",
]);

/** Parse a clipboard `text/html` string into AST blocks plus the numbering
 *  definitions its lists allocated. */
export function parseClipboardHtml(html: string): {
  blocks: Block[];
  numbering: NumberingDefinition[];
} {
  const dom = new DOMParser().parseFromString(html, "text/html");
  const flat = flattenForPaste(dom.body);
  const ctx: BlockSerializeContext = { numbering: [], currentList: null, sectionBreaks: 0 };
  const blocks = blocksFromNodes(flat, ctx);
  return { blocks, numbering: ctx.numbering };
}

/**
 * Flatten `container`'s subtree into the flat block-element list
 * `blocksFromNodes` consumes: mapped block elements pass through, wrapper
 * containers recurse, and runs of loose inline siblings (text, `<span>`,
 * `<b>`, `<a>`, `<br>`, …) are grouped into a synthetic `<p>` so they become
 * one paragraph instead of one-per-node.
 */
function flattenForPaste(container: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  let inlineBuffer: Node[] = [];

  const flushInline = (): void => {
    const meaningful = inlineBuffer.some(
      (n) =>
        (n.textContent ?? "").trim() !== "" ||
        (n instanceof HTMLElement && (n.tagName === "BR" || n.tagName === "IMG")),
    );
    if (meaningful) {
      const p = container.ownerDocument.createElement("p");
      for (const n of inlineBuffer) p.appendChild(n.cloneNode(true));
      out.push(p);
    }
    inlineBuffer = [];
  };

  for (const node of Array.from(container.childNodes)) {
    if (node instanceof HTMLElement) {
      const tag = node.tagName.toLowerCase();
      if (MAPPED_BLOCK_TAGS.has(tag)) {
        flushInline();
        out.push(node);
        continue;
      }
      if (GENERIC_CONTAINER_TAGS.has(tag)) {
        flushInline();
        // A wrapper holding blocks recurses; a wrapper of only inline content is
        // handed to `blocksFromNodes` whole (it maps an unknown block to one
        // paragraph via `serializeInlineChildren`).
        if (hasBlockChild(node)) out.push(...flattenForPaste(node));
        else out.push(node);
        continue;
      }
      // Inline element — buffer it into the current paragraph.
      inlineBuffer.push(node);
    } else if (node.nodeType === Node.TEXT_NODE) {
      inlineBuffer.push(node);
    }
  }
  flushInline();
  return out;
}

/** Whether `el` has a child that is itself a block (so `el` is a wrapper to
 *  recurse into, not a paragraph). */
function hasBlockChild(el: HTMLElement): boolean {
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase();
    if (MAPPED_BLOCK_TAGS.has(tag) || GENERIC_CONTAINER_TAGS.has(tag)) return true;
  }
  return false;
}

// === insertion ===

/**
 * Parse `html` and insert it at the current selection through the typed API
 * (model-first rich paste). Returns `false` when nothing usable parsed (caller
 * falls back to plain-text paste). Tracked mode stamps inserted runs / paragraph
 * marks `ins`. A single plain paragraph SPLICES inline into the caret paragraph
 * (keeping it one block); anything with block structure splits the caret
 * paragraph and merges the first / last plain paragraphs into the two halves —
 * matching how Word/Google paste multi-paragraph content at a caret.
 */
export function pasteHtmlAtCaret(ctx: EditorContext, html: string): boolean {
  const parsed = parseClipboardHtml(html);
  if (parsed.blocks.length === 0) return false;
  ctx.ensureCurrent();

  // Remap the paste's list numIds clear of the document's, and register the
  // definitions so the pasted list renders with the right markers.
  const { blocks: remapped, addedNumbering } = remapNumbering(
    parsed.blocks,
    parsed.numbering,
    ctx.doc.numbering ?? [],
  );
  if (addedNumbering.length > 0) {
    ctx.commit({ numbering: [...(ctx.doc.numbering ?? []), ...addedNumbering] }, []);
  }

  const author = ctx.trackChanges.enabled ? ctx.trackChanges.author : undefined;
  const blocks = ctx.trackChanges.enabled
    ? remapped.map((b) => stampBlockRuns(b, author))
    : remapped;

  const caret = collapseToCaret(ctx);
  if (!caret) return false;
  const targetIdx = ctx.registry.indexOf(caret.block.id);
  const target = ctx.doc.body[targetIdx];
  if (targetIdx < 0 || target?.kind !== "paragraph") {
    // Caret not in a body paragraph (e.g. a table cell): append the blocks
    // after it rather than splice.
    return insertBlocksAfter(ctx, ctx.registry.refAt(targetIdx), blocks);
  }

  const targetRef = ctx.registry.refAt(targetIdx);
  const { before, after } = splitRunsAt(target.runs, caret.offset);

  // Inline paste: one plain paragraph splices into the caret paragraph so it
  // stays a single block.
  if (blocks.length === 1 && isMergeable(blocks[0]!)) {
    const inserted = (blocks[0] as Paragraph).runs;
    const runs = mergeAdjacentTextRuns([...before, ...inserted, ...after]);
    const res = replaceBlock(ctx, targetRef, { ...target, runs });
    if (res.ok) query.placeCaret(ctx, targetRef.id, caret.offset + runsLength(inserted));
    return true;
  }

  // Block paste: the first / last plain paragraphs merge into the split halves;
  // the middle blocks insert between.
  let list = blocks;
  let headRuns = before;
  if (list.length > 0 && isMergeable(list[0]!)) {
    headRuns = mergeAdjacentTextRuns([...before, ...(list[0] as Paragraph).runs]);
    list = list.slice(1);
  }
  let tailRuns = after;
  let mergedTail = false;
  if (list.length > 0 && isMergeable(list[list.length - 1]!)) {
    tailRuns = mergeAdjacentTextRuns([...(list[list.length - 1] as Paragraph).runs, ...after]);
    list = list.slice(0, -1);
    mergedTail = true;
  }

  replaceBlock(ctx, targetRef, { ...target, runs: headRuns });
  // `replaceBlock` bumped the block's version — refetch a fresh ref by (stable)
  // id, or the next insert's optimistic-lock check fails on the stale version.
  let afterRef = ctx.registry.refById(targetRef.id) ?? targetRef;
  for (const block of list) {
    const res = insertBlockAfter(ctx, afterRef, block);
    const ref = res.ok ? res.affected[0] : undefined;
    if (!ref) return true;
    afterRef = ref;
  }

  // A tail paragraph carries the ORIGINAL paragraph's block properties (the
  // remainder keeps its style). Emit it when there was content after the caret
  // or a trailing paragraph merged into it.
  if (mergedTail || after.length > 0) {
    const tail: Paragraph = {
      kind: "paragraph",
      properties: { ...target.properties },
      runs: tailRuns,
    };
    const res = insertBlockAfter(ctx, afterRef, tail);
    const ref = res.ok ? res.affected[0] : undefined;
    if (ref) query.placeCaret(ctx, ref.id, 0);
  } else {
    query.placeCaret(ctx, afterRef.id, blockEndOffset(ctx, afterRef.id));
  }
  return true;
}

/** Collapse the current selection to a caret, deleting a selected range first.
 *  Returns the resulting caret position, or `null`. */
function collapseToCaret(ctx: EditorContext): InlinePosition | null {
  const sel = ctx.selection.get();
  if (!sel) return null;
  if (sel.kind === "caret") return query.refreshedPosition(ctx, sel.at);
  const range: ApiRange = sel.range;
  const del = deleteRange(ctx, range);
  if (!del.ok) return null;
  return query.refreshedPosition(ctx, range.from);
}

/** Fallback: insert `blocks` after `afterRef` in order (no splice). */
function insertBlocksAfter(
  ctx: EditorContext,
  afterRef: ReturnType<EditorContext["registry"]["refAt"]>,
  blocks: readonly Block[],
): boolean {
  let ref = afterRef;
  for (const block of blocks) {
    const res = insertBlockAfter(ctx, ref, block);
    const inserted = res.ok ? res.affected[0] : undefined;
    if (!inserted) return true;
    ref = inserted;
  }
  query.placeCaret(ctx, ref.id, 0);
  return true;
}

/** A plain paragraph whose runs may merge into another paragraph — no heading
 *  style, no list membership. */
function isMergeable(block: Block): boolean {
  return block.kind === "paragraph" && !block.properties.styleId && !block.properties.numbering;
}

/** Offset length of a run list (text length; every non-text inline is 1). */
function runsLength(runs: readonly InlineRun[]): number {
  return runs.reduce((n, r) => n + (r.kind === "text" ? r.text.length : 1), 0);
}

/** Content offset at the end of a block, for caret placement. */
function blockEndOffset(ctx: EditorContext, blockId: string): number {
  const info = query.getBlockById(ctx, blockId);
  return info ? info.length : 0;
}

/** Stamp a block's text runs (and hyperlink children) with an `ins` revision —
 *  the tracked-paste marker for pasted content. */
function stampBlockRuns(block: Block, author: string | undefined): Block {
  if (block.kind !== "paragraph") return block;
  return { ...block, runs: block.runs.map((r) => stampRun(r, author)) };
}

function stampRun(run: InlineRun, author: string | undefined): InlineRun {
  if (run.kind === "hyperlink") {
    return { ...run, children: run.children.map((c) => stampRun(c, author)) };
  }
  return stampInsertRevision(run, author);
}

/**
 * Remap the paste's list numIds (local, starting at 1) above the document's
 * highest, returning the rewritten blocks and the numbering definitions to
 * register. A no-op when the paste has no lists.
 */
function remapNumbering(
  blocks: Block[],
  pastedNumbering: readonly NumberingDefinition[],
  docNumbering: readonly NumberingDefinition[],
): { blocks: Block[]; addedNumbering: NumberingDefinition[] } {
  if (pastedNumbering.length === 0) return { blocks, addedNumbering: [] };
  const base = docNumbering.reduce((max, n) => Math.max(max, n.numId), 0);
  const idMap = new Map<number, number>();
  const added = pastedNumbering.map((def) => {
    const numId = base + def.numId;
    idMap.set(def.numId, numId);
    return { ...def, numId };
  });
  return { blocks: blocks.map((b) => remapBlockNumbering(b, idMap)), addedNumbering: added };
}

function remapBlockNumbering(block: Block, idMap: Map<number, number>): Block {
  if (block.kind !== "paragraph" || !block.properties.numbering) return block;
  const mapped = idMap.get(block.properties.numbering.numId);
  if (mapped === undefined) return block;
  const properties: ParagraphProperties = {
    ...block.properties,
    numbering: { ...block.properties.numbering, numId: mapped },
  };
  return { ...block, properties };
}
