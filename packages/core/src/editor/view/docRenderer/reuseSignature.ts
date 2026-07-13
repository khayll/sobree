import type { Block, NumberingDefinition } from "../../../doc/types";
import { isVisuallyEmptyBlock, paragraphHasPageBreakRun } from "./block";
import { paragraphListInfo } from "./lists";

/**
 * A stable string capturing every BODY field that affects any block's render
 * CONTEXT — the running page-break deferral, section index, list grouping,
 * outline numbering, and neighbour contextual-spacing — but NOT a paragraph's
 * run content (which is what an in-place edit changes). Two bodies with the
 * same signature render every block in an identical context, so a block whose
 * OWN JSON is also unchanged is provably safe to reuse. See
 * `devdocs/plan-model-first-editing.md`, PR 2.
 *
 * Fields and why each is here (all read by `renderBlocks`):
 *   - `styleId` — contextual-spacing neighbour match AND the cascade an
 *     unchanged neighbour depends on; also fixes heading level (→ outline).
 *   - list `numId`/`ordered` — consecutive same-`numId` paragraphs group into
 *     one `<ul>/<ol>`; a change re-groups adjacent items.
 *   - `pageBreakBefore` / page-break run + visual emptiness — drive the
 *     running page-break DEFERRAL that can move a break onto a later block.
 *   - `contextualSpacing` flag — whether the before/after margin drops.
 *   - section-break `toSectionIndex` — ticks the section index and column
 *     config for every following block.
 *
 * Document-level inputs (styles, numbering, sections, settings, anchored-frame
 * indices) are compared by REFERENCE in the pipeline, so they aren't repeated
 * here — keeping this cheap enough to run per keystroke.
 */
export function bodyStructureSignature(
  body: readonly Block[],
  numbering: readonly NumberingDefinition[],
): string {
  const parts: string[] = [];
  for (const b of body) {
    if (b.kind === "paragraph") {
      const list = paragraphListInfo(b, numbering);
      const listSig = list ? `${list.numId}.${list.ordered ? 1 : 0}` : "";
      const brk = b.properties.pageBreakBefore || paragraphHasPageBreakRun(b) ? 1 : 0;
      const empty = isVisuallyEmptyBlock(b) ? 1 : 0;
      const ctx = b.properties.contextualSpacing ? 1 : 0;
      parts.push(`p:${b.properties.styleId ?? ""}:${listSig}:${brk}:${empty}:${ctx}`);
    } else if (b.kind === "section_break") {
      parts.push(`s:${b.toSectionIndex}`);
    } else {
      // table / inline_frame: internal content changes go through the
      // per-block JSON equality check, not this signature.
      parts.push(b.kind);
    }
  }
  return parts.join("|");
}
