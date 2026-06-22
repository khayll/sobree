/**
 * In-flow conversion for displacing anchored textboxes.
 *
 * Some `<wp:anchor>` drawings are floating *decorations* (a photo
 * placeholder, a watermark) — they belong in the absolute overlay
 * layer. But others are really just **framed body content**: a
 * wrapping textbox (or a group whose payload is textboxes) anchored to
 * a paragraph, carrying a chunk of the document's prose. Word lays
 * those out in the text flow — they push following content down and,
 * crucially, **paginate** when they're taller than the page.
 *
 * Sobree renders anchored frames as a single absolute overlay clipped
 * to its box, and the paginator only splits in-flow content — so a
 * tall content textbox clips at the page bottom instead of continuing
 * on the next page (complex-multipage's project writeups). The fix is
 * to recognise these for what they are and splice their text back into
 * `doc.body` at the anchor paragraph, dropping the overlay. From then
 * on they're ordinary blocks: they flow, paginate, edit, and persist
 * like any other paragraph.
 *
 * Scope is deliberately narrow — only frames that:
 *   - displace text (`square`/`topAndBottom`/`tight`/`through` wrap,
 *     in front of the text, paragraph-anchored), AND
 *   - carry textbox body content, AND
 *   - have no box chrome (fill/border) worth preserving.
 * Everything else (pictures, shapes, behind-text, `wrapNone` floats,
 * bordered/filled boxes) stays an overlay, unchanged.
 */

import type {
  AnchoredContent,
  AnchoredFrame,
  Block,
  DrawingRun,
  Paragraph,
  SectionProperties,
} from "../../doc/types";

/** A frame whose content should flow inline rather than overlay. */
function isFlowable(frame: AnchoredFrame, sections: readonly SectionProperties[]): boolean {
  if (frame.behindText) return false;
  // A column-anchored textbox in a MULTI-COLUMN section is a positioned
  // panel in a grid (a brochure/trifold), not a flow call-out. Splicing it
  // into the body at its anchor paragraph would stack the parallel panels
  // into one snaking column and destroy the layout. Single-column sections
  // keep the flow treatment (a tall in-column call-out that must paginate).
  if ((sections[frame.anchor.sectionIndex]?.columns?.count ?? 1) > 1) return false;
  // Only a textbox positioned relative to the text COLUMN shares the
  // body's coordinate system — splicing it in at the anchor keeps it
  // where Word drew it. A box positioned relative to the page MARGIN or
  // PAGE is an absolute layout element: a flyer's grid of headings and
  // call-outs sits at fixed page coordinates, and inlining those would
  // stack them into a single column and destroy the layout. Those stay
  // positioned overlays. (Vertical anchoring is `paragraph` for both —
  // it's the HORIZONTAL frame that tells flow from absolute placement.)
  if (frame.anchor.horizontalFrom !== "column") return false;
  if (frame.anchor.verticalFrom !== "paragraph") return false;
  if (frame.anchor.paragraphIndex === undefined) return false;
  switch (frame.wrap) {
    case "square":
    case "topAndBottom":
    case "tight":
    case "through":
      break;
    default:
      return false;
  }
  if (hasChrome(frame.content)) return false;
  return hasTextboxContent(frame.content);
}

/** True when the content paints a VISIBLE box (a border, or a fill
 *  that isn't white) that the flat in-flow form would lose — keep
 *  those as overlays. A white fill is invisible on the page, so it
 *  doesn't count (the "Project: X" heading boxes carry `#FFFFFF`). */
function hasChrome(content: AnchoredContent): boolean {
  switch (content.kind) {
    case "textbox":
    case "shape":
      if (content.border !== undefined) return true;
      return content.fill !== undefined && !isWhite(content.fill);
    case "group":
      return content.children.some((c) => hasChrome(c.content));
    default:
      return false;
  }
}

/** Treat white (Word's default textbox fill) as no visible chrome. */
function isWhite(color: string): boolean {
  const c = color.trim().toLowerCase();
  return c === "#ffffff" || c === "#fff" || c === "white";
}

/** True when a frame carries any textbox prose (recursively). Cheap
 *  predicate for `isFlowable` — the heavy flatten runs only on keepers. */
function hasTextboxContent(content: AnchoredContent): boolean {
  switch (content.kind) {
    case "textbox":
      return true;
    case "group":
      return content.children.some((c) => hasTextboxContent(c.content));
    default:
      return false;
  }
}

/**
 * Flatten a frame's content into body blocks in document order.
 * Textbox bodies contribute their paragraphs; groups recurse
 * depth-first (a project group emits its heading textbox then its
 * detail textbox). A decorative picture (the ► project arrow) is
 * carried into the flow as a leading inline image on the next
 * paragraph — so it survives, at its TRUE size.
 *
 * Picture sizing follows the group coordinate chain: a group's
 * children live in its local system (`childCoordSystemCx/Cy`) and
 * render at the frame's extent, so each level multiplies the scale
 * (`frameSize / childCoordSystem`). The scale is applied per-axis —
 * the project group's `ext` is ~3.6× taller than its `chExt`, and that
 * anisotropic factor is exactly what restores the ► arrow's authored
 * shape: its `ext` (≈2.7:1 wide) is squished in the group's local
 * space, and the vertical scale un-squishes it back to the source
 * image's true 0.72:1 (36×50), matching how Word/LO render it.
 */
function flattenFrame(frame: AnchoredFrame): Block[] {
  return flattenContent(frame.content, frame.widthEmu, frame.heightEmu);
}

function flattenContent(
  content: AnchoredContent,
  renderedWidthEmu: number,
  renderedHeightEmu: number,
): Block[] {
  switch (content.kind) {
    case "textbox":
      return content.body;
    case "group": {
      const sx = content.childCoordSystemCx > 0 ? renderedWidthEmu / content.childCoordSystemCx : 1;
      const sy =
        content.childCoordSystemCy > 0 ? renderedHeightEmu / content.childCoordSystemCy : 1;
      return flattenChildren(content.children, sx, sy);
    }
    default:
      return [];
  }
}

function flattenChildren(
  frames: readonly AnchoredFrame[],
  scaleX: number,
  scaleY: number,
): Block[] {
  const out: Block[] = [];
  let pending: DrawingRun[] = [];
  for (const frame of frames) {
    const renderedW = frame.widthEmu * scaleX;
    const renderedH = frame.heightEmu * scaleY;
    const content = frame.content;
    if (content.kind === "picture") {
      pending.push(toInlineImage(content, renderedW, renderedH));
    } else if (content.kind === "textbox") {
      out.push(...withLeadingImages(content.body, pending));
      pending = [];
    } else if (content.kind === "group") {
      out.push(...withLeadingImages(flattenContent(content, renderedW, renderedH), pending));
      pending = [];
    }
    // shapes contribute nothing
  }
  return out;
}

/** An anchored picture → an inline image run at its rendered size. */
function toInlineImage(
  content: Extract<AnchoredContent, { kind: "picture" }>,
  widthEmu: number,
  heightEmu: number,
): DrawingRun {
  const run: DrawingRun = {
    kind: "drawing",
    partPath: content.partPath,
    widthEmu: Math.round(widthEmu),
    heightEmu: Math.round(heightEmu),
    placement: "inline",
    // The arrow is a heading decoration taller than its label; centre
    // it on the text so the label sits beside its middle, matching how
    // Word renders the (vertically-stretched) heading textbox.
    verticalAlign: "middle",
  };
  if (content.altText !== undefined) run.altText = content.altText;
  return run;
}

/**
 * Prepend `images` to the first paragraph in `blocks` (cloned, so the
 * source AST isn't mutated). When there's no paragraph or no images,
 * the blocks pass through unchanged.
 */
function withLeadingImages(blocks: Block[], images: DrawingRun[]): Block[] {
  if (images.length === 0) return blocks;
  const idx = blocks.findIndex((b) => b.kind === "paragraph");
  if (idx === -1) return blocks;
  const target = blocks[idx] as Paragraph;
  const merged: Paragraph = { ...target, runs: [...images, ...target.runs] };
  const out = blocks.slice();
  out[idx] = merged;
  return out;
}

/**
 * Splice flowable frames' content into `body` at their anchor
 * paragraph and drop them from the overlay set. Returns the rebuilt
 * body and the frames that remain overlays (with `paragraphIndex`
 * remapped to the new body positions). Pure — no mutation of inputs.
 */
export function flowDisplacingTextboxes(
  body: readonly Block[],
  frames: readonly AnchoredFrame[],
  sections: readonly SectionProperties[],
): { body: Block[]; frames: AnchoredFrame[] } {
  const flowable = frames.filter((f) => isFlowable(f, sections));
  if (flowable.length === 0) {
    return { body: body.slice(), frames: frames.slice() };
  }

  // Group flowable frames by their anchor paragraph (document order
  // preserved: a paragraph hosting several frames emits them in array
  // order).
  const byAnchor = new Map<number, AnchoredFrame[]>();
  for (const frame of flowable) {
    const pi = frame.anchor.paragraphIndex as number;
    const bucket = byAnchor.get(pi);
    if (bucket) bucket.push(frame);
    else byAnchor.set(pi, [frame]);
  }

  // Rebuild the body, inserting each anchor paragraph's flowed content
  // right after it. Track old→new index so the remaining overlay
  // frames' `paragraphIndex` stays valid.
  const newBody: Block[] = [];
  const oldToNew = new Map<number, number>();
  for (let i = 0; i < body.length; i++) {
    oldToNew.set(i, newBody.length);
    newBody.push(body[i]!);
    const here = byAnchor.get(i);
    if (here) {
      for (const frame of here) newBody.push(...flattenFrame(frame));
    }
  }

  const flowedIds = new Set(flowable.map((f) => f.id));
  const remaining: AnchoredFrame[] = [];
  for (const frame of frames) {
    if (flowedIds.has(frame.id)) continue;
    const pi = frame.anchor.paragraphIndex;
    const remapped = pi !== undefined ? oldToNew.get(pi) : undefined;
    if (remapped !== undefined && remapped !== pi) {
      remaining.push({ ...frame, anchor: { ...frame.anchor, paragraphIndex: remapped } });
    } else {
      remaining.push(frame);
    }
  }

  return { body: newBody, frames: remaining };
}
