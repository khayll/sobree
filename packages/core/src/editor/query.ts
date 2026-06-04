import type { InlinePosition } from "../doc/api";
import { runsLength } from "../doc/runs";
import type { Block, Paragraph } from "../doc/types";
import { headingLevelOf, runsToText } from "../doc/walk";
import type { EditorContext } from "./context";
import type { BlockInfo, OutlineItem } from "./types";
import { renderSobreeDocument } from "./view/docRenderer/index";

/**
 * Read-only projections of the document — block summaries, the heading
 * outline, an HTML snapshot — plus the two position helpers
 * (`placeCaret` / `refreshedPosition`) that resolve a block id to a live
 * ref. All pull through `ctx.ensureCurrent()` so a pending DOM edit is
 * folded in before the read. No mutation, no commit.
 */

export function toHtml(ctx: EditorContext): string {
  const scratch = document.createElement("div");
  renderSobreeDocument(ctx.syncFromDom(), scratch);
  return scratch.innerHTML;
}

export function getBlocks(ctx: EditorContext): BlockInfo[] {
  const doc = ctx.ensureCurrent();
  return doc.body.map((block, index) => summariseBlock(ctx, block, index));
}

export function getBlock(ctx: EditorContext, index: number): BlockInfo {
  const blocks = getBlocks(ctx);
  const b = blocks[index];
  if (!b) throw new Error(`block index ${index} out of range`);
  return b;
}

/** Same summary, looked up by stable id. Returns `null` if unknown. */
export function getBlockById(ctx: EditorContext, id: string): BlockInfo | null {
  const index = ctx.registry.indexOf(id);
  if (index < 0) return null;
  return getBlock(ctx, index);
}

export function getOutline(ctx: EditorContext): OutlineItem[] {
  const doc = ctx.ensureCurrent();
  const out: OutlineItem[] = [];
  doc.body.forEach((block, index) => {
    if (block.kind !== "paragraph") return;
    const level = headingLevelOf(block);
    if (!level) return;
    out.push({
      level,
      text: runsToText(block.runs),
      blockIndex: index,
      block: ctx.registry.refAt(index),
    });
  });
  return out;
}

export function summariseBlock(ctx: EditorContext, block: Block, index: number): BlockInfo {
  const ref = ctx.registry.refAt(index);
  const baseInfo = {
    index,
    id: ref.id,
    version: ref.version,
  };
  if (block.kind === "paragraph") {
    const info: BlockInfo = {
      ...baseInfo,
      kind: "paragraph",
      text: runsToText(block.runs),
      length: runsLength(block.runs),
    };
    if (block.properties.styleId) info.styleId = block.properties.styleId;
    if (block.properties.alignment) info.alignment = block.properties.alignment;
    return info;
  }
  if (block.kind === "table") {
    const firstCell = block.rows[0]?.cells[0];
    const firstPara = firstCell?.content.find((b): b is Paragraph => b.kind === "paragraph");
    const preview = firstPara ? runsToText(firstPara.runs) : "";
    return {
      ...baseInfo,
      kind: "table",
      text: preview,
      length: 0,
    };
  }
  return { ...baseInfo, kind: block.kind, text: "", length: 0 };
}

/** Refresh a position's block ref to the live version (id stays stable). */
export function refreshedPosition(
  ctx: EditorContext,
  at: InlinePosition,
): InlinePosition | null {
  const info = getBlockById(ctx, at.block.id);
  if (!info) return null;
  return { block: { id: info.id, version: info.version }, offset: at.offset };
}

/** Place the caret at `(blockId, offset)` using a fresh block ref. */
export function placeCaret(ctx: EditorContext, blockId: string, offset: number): void {
  const info = getBlockById(ctx, blockId);
  if (!info) return;
  const clamped = Math.max(0, Math.min(offset, info.length));
  ctx.selection.set({
    kind: "caret",
    at: { block: { id: info.id, version: info.version }, offset: clamped },
  });
}
