import { renderBlocks } from "../editor/view/docRenderer/block";
import {
  type AnchorLayerContext,
  renderAnchorLayer,
} from "../editor/view/docRenderer/anchorLayer";
import type {
  AnchoredFrame,
  Block,
  NamedStyle,
  NumberingDefinition,
} from "../doc/types";

/**
 * Everything a header/footer zone needs to render its FLOW content. The
 * floating layer (anchored frames) is painted separately via
 * {@link paintZoneFrames} — a zone is a flow layer + a float layer, the
 * same two-layer model the body uses.
 */
export interface ZoneRenderContext {
  blocks: readonly Block[];
  numbering: readonly NumberingDefinition[];
  styles: readonly NamedStyle[];
  rawParts: Record<string, Uint8Array>;
  pageNumber: number;
  totalPages: number;
}

/**
 * Render a zone's flow blocks. Uses the same `renderBlocks` walker as
 * body content so drawings, formatting, hyperlinks and tables all carry
 * through. `PAGE` / `NUMPAGES` field nodes are substituted with this
 * paper's page number / the total count.
 *
 * "Empty" here = no rendered text anywhere; an image-only header still
 * counts as non-empty so the `is-empty` CSS doesn't collapse its space.
 */
export function renderZone(zone: HTMLElement, ctx: ZoneRenderContext): void {
  zone.replaceChildren();
  if (ctx.blocks.length === 0) {
    zone.classList.add("is-empty");
    return;
  }
  renderBlocks(ctx.blocks, zone, ctx.numbering, ctx.styles, ctx.rawParts);
  substituteFieldNodes(zone, ctx.pageNumber, ctx.totalPages);
  const hasContent =
    (zone.textContent ?? "").trim().length > 0 ||
    zone.querySelector("img, svg, table, .sobree-field") !== null;
  zone.classList.toggle("is-empty", !hasContent);
}

/**
 * Paint a zone's floating frames into its overlay element. Mirrors
 * `Paper.setAnchoredFrames` for the body: `renderAnchorLayer` builds a
 * fresh layer, we copy its children into the persistent overlay node so
 * external observers keep a stable reference, and `is-empty` collapses
 * the overlay when there are no frames.
 */
export function paintZoneFrames(
  overlay: HTMLElement,
  frames: readonly AnchoredFrame[],
  ctx: AnchorLayerContext,
): void {
  const fresh = renderAnchorLayer(frames, ctx);
  overlay.replaceChildren(...Array.from(fresh.children));
  overlay.classList.toggle("is-empty", frames.length === 0);
}

export function setZoneText(zone: HTMLElement, text: string): void {
  zone.textContent = text;
  zone.classList.toggle("is-empty", text.trim() === "");
}

/**
 * Walk the rendered zone subtree, replacing each
 * `<span class="sobree-field" data-field="...">` node's text with the
 * live PAGE / NUMPAGES value for this paper.
 *
 * Done as a post-render pass instead of inside the inline renderer so
 * `renderBlocks` stays page-agnostic (it has no concept of "which page
 * is this paragraph on") and the zone pipeline keeps the substitution
 * concern in one place.
 */
function substituteFieldNodes(
  zone: HTMLElement,
  pageNumber: number,
  totalPages: number,
): void {
  const fields = zone.querySelectorAll<HTMLElement>("span.sobree-field");
  for (const field of Array.from(fields)) {
    const instr = (field.dataset.field ?? "").trim().toUpperCase();
    if (instr === "PAGE") field.textContent = String(pageNumber);
    else if (instr === "NUMPAGES") field.textContent = String(totalPages);
    // Unknown instructions keep whatever the AST cached (Word writes a
    // cached value for non-resolvable fields, e.g. SECTION). No-op.
  }
}
