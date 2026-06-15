/**
 * Render an `InlineFrame` block — a `<w:drawing><wp:inline>` group that
 * carries a textbox (section headings like "Objective" / "Project: X"
 * on complex-multipage.docx) plus decorative pictures/shapes.
 *
 * The frame renders in body flow (it paginates), as a `position:
 * relative` wrapper sized to the group's height. Decorations
 * (pictures, shapes, the textbox region) are absolute-positioned
 * children scaled from the group's local coordinate system into the
 * wrapper's rendered size: horizontal via percentage of the content
 * width, vertical in millimetres from the group EMU.
 *
 * The textbox body renders recursively through the SAME block pipeline
 * (paragraphs, lists, tables, even nested frames). To avoid a
 * `block.ts ↔ inlineFrame.ts` import cycle, the caller injects the
 * renderer as `renderBody`.
 */

import type {
  Block,
  DrawingRun,
  InlineFrame,
  NamedStyle,
  NumberingDefinition,
  Paragraph,
} from "../../../doc/types";
import { partPathToUrl } from "./inline";
import { applyParagraphProps } from "./properties";
import { emuToMm } from "./units";

/** The recursive block renderer, injected to break the import cycle. */
export type RenderBody = (
  blocks: readonly Block[],
  host: HTMLElement,
  numbering: readonly NumberingDefinition[],
  styles: readonly NamedStyle[],
  rawParts: Record<string, Uint8Array>,
) => void;

export function renderInlineFrameBlock(
  frame: InlineFrame,
  numbering: readonly NumberingDefinition[],
  styles: readonly NamedStyle[],
  rawParts: Record<string, Uint8Array>,
  renderBody: RenderBody,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "sobree-inline-frame";
  // The frame's host paragraph contributes its box spacing (commonly
  // Normal's `<w:spacing w:after>`) — the band must reserve the SAME
  // vertical box Word does: drawing height PLUS the paragraph's
  // spacing-after. Apply the host paragraph's resolved properties
  // (spacing / alignment) the same way body paragraphs get them; the
  // wrapper's own structural styles below override any overlap. The
  // wrapper has no in-flow text (all children are absolute-positioned),
  // so font / line-height applied here are inert — only the margins
  // matter, and they're what closes the per-band vertical deficit.
  applyParagraphProps(wrapper, frame.hostProps ?? {}, styles);
  wrapper.style.position = "relative";
  wrapper.style.boxSizing = "border-box";
  wrapper.style.width = "100%";
  // Frame's intrinsic height — the paginator measures this to decide
  // page boundaries. Width is the content width (100%) so the frame
  // fills the body column; pictures scale by sizeEmu / groupExtentEmu.
  // An inline drawing occupies EXACTLY its `<wp:extent>` in the body flow —
  // a fixed box, like a tall glyph. It never grows to its content: the
  // textboxes are `<a:noAutofit/>` (Word never resizes them), so overflowing
  // text spills VISIBLY but does not change the frame's flow height. Pinning
  // the height to the rendered extent is what keeps pagination matching
  // Word's page count (a `min-height` that grows would inflate page count).
  wrapper.style.height = `${emuToMm(frame.sizeEmu.hEmu)}mm`;
  wrapper.style.overflow = "visible";
  // `.paper-content` is a flex column, so the frame is a flex item. Its
  // children are all absolutely positioned (no in-flow content), so the
  // flex `min-height: auto` resolves to 0 — and on a densely-packed page
  // where the column overflows, the default `flex-shrink: 1` would compress
  // the frame to 0, collapsing the box and clipping its text. Pin it: the
  // height above is the FIXED extent (not a growing min-height), so
  // flex-shrink:0 simply holds every frame at exactly its extent.
  wrapper.style.flexShrink = "0";
  if (frame.pageBreakBefore) wrapper.setAttribute("data-page-break-before", "");
  if (frame.keepNext) wrapper.setAttribute("data-keep-next", "");

  // Children live in the group's child coordinate system (groupExtentEmu =
  // `<a:chExt>`). The wrapper IS the group's rendered ext, so positioning
  // AND sizing each child as a PERCENTAGE of groupExtentEmu in BOTH axes
  // maps chExt → ext automatically — including the group's (often
  // non-uniform) vertical scale `sy = sizeEmu.h / groupExtentEmu.h`. The
  // old code applied scale only horizontally and used raw `emuToMm`
  // vertically, rendering every textbox ~10% too short so its content
  // clipped / overflowed.
  const cw = frame.groupExtentEmu.wEmu;
  const ch = frame.groupExtentEmu.hEmu;
  const pctX = (emu: number): number => (cw > 0 ? (emu / cw) * 100 : 0);
  const pctY = (emu: number): number => (ch > 0 ? (emu / ch) * 100 : 0);

  // A group with multiple textboxes (a "Project: X" entry: title + details)
  // — or a single textbox with no decoration (a project detail block) — is
  // PROSE: render its textboxes stacked IN FLOW (content-sized, no clip,
  // per the textbox-only path) and carry the group's picture (the ► arrow)
  // as a LEADING INLINE IMAGE on the first textbox so it sits beside the
  // title. A single textbox OVER a picture/shape is a DECORATIVE pill —
  // keep the absolute fixed-height overlay (the textbox sits on top).
  const prose =
    frame.textboxes.length > 1 ||
    (frame.textboxes.length === 1 && frame.pictures.length === 0 && frame.shapes.length === 0);

  // Decorative pictures paint as absolute overlays (a pill's rounded-rect
  // background). For prose the same pictures become leading inline images
  // (built below) instead, so skip the overlay pass.
  if (!prose) {
    for (const pic of frame.pictures) {
      const url = partPathToUrl(pic.partPath, rawParts);
      if (!url) continue;
      const img = document.createElement("img");
      img.src = url;
      img.alt = pic.altText ?? "";
      img.style.position = "absolute";
      img.style.left = `${pctX(pic.offsetEmu.xEmu)}%`;
      img.style.top = `${pctY(pic.offsetEmu.yEmu)}%`;
      img.style.width = `${pctX(pic.sizeEmu.wEmu)}%`;
      img.style.height = `${pctY(pic.sizeEmu.hEmu)}%`;
      img.style.objectFit = "fill";
      wrapper.appendChild(img);
    }
  }

  for (const shape of frame.shapes) {
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.left = `${pctX(shape.offsetEmu.xEmu)}%`;
    el.style.top = `${pctY(shape.offsetEmu.yEmu)}%`;
    el.style.width = `${pctX(shape.sizeEmu.wEmu)}%`;
    el.style.height = `${pctY(shape.sizeEmu.hEmu)}%`;
    if (shape.fill) el.style.background = shape.fill;
    if (shape.geometry === "ellipse") el.style.borderRadius = "50%";
    else if (shape.geometry === "roundedRect") el.style.borderRadius = "8px";
    wrapper.appendChild(el);
  }

  // The group's picture(s) → leading inline images on the FIRST prose
  // textbox (the ► arrow before "Project: X"). Sized to the rendered
  // group (frame.sizeEmu / groupExtentEmu) so the arrow keeps its shape.
  const sx = frame.groupExtentEmu.wEmu > 0 ? frame.sizeEmu.wEmu / frame.groupExtentEmu.wEmu : 1;
  const sy = frame.groupExtentEmu.hEmu > 0 ? frame.sizeEmu.hEmu / frame.groupExtentEmu.hEmu : 1;
  const leadingImages: DrawingRun[] = prose
    ? frame.pictures.map(
        (pic): DrawingRun => ({
          kind: "drawing",
          partPath: pic.partPath,
          widthEmu: Math.round(pic.sizeEmu.wEmu * sx),
          heightEmu: Math.round(pic.sizeEmu.hEmu * sy),
          placement: "inline",
          // Centre the arrow on the title line (it's taller than the text).
          verticalAlign: "middle",
          ...(pic.altText !== undefined ? { altText: pic.altText } : {}),
        }),
      )
    : [];

  frame.textboxes.forEach((tb, i) => {
    const region = document.createElement("div");
    // Every textbox is a fixed-size box positioned at its group-local
    // offset (both axes scaled by %-of-groupExtent, so sy applies). The
    // box NEVER changes the frame's flow height — that's the extent.
    region.style.position = "absolute";
    region.style.left = `${pctX(tb.offsetEmu.xEmu)}%`;
    region.style.top = `${pctY(tb.offsetEmu.yEmu)}%`;
    region.style.width = `${pctX(tb.sizeEmu.wEmu)}%`;
    region.style.height = `${pctY(tb.sizeEmu.hEmu)}%`;
    // `<a:noAutofit/>` semantics: prose project entries overflow VISIBLY
    // (never cut off — the #18 complaint); decorative pill headings clip
    // their single centred label to the rounded background.
    region.style.overflow = prose ? "visible" : "hidden";
    region.style.boxSizing = "border-box";
    // Honour the textbox's vertical anchor (`<wps:bodyPr anchor>`): a
    // flex column whose justification places the body at top / centre /
    // bottom of the region. Word relies on this to vertically centre a
    // single heading line inside the section pills.
    region.style.display = "flex";
    region.style.flexDirection = "column";
    region.style.justifyContent =
      tb.vAlign === "center" ? "center" : tb.vAlign === "bottom" ? "flex-end" : "flex-start";
    if (tb.fill) region.style.background = tb.fill;
    if (tb.padding) {
      const p = tb.padding;
      region.style.padding =
        `${emuToMm(p.topEmu)}mm ` +
        `${emuToMm(p.rightEmu)}mm ` +
        `${emuToMm(p.bottomEmu)}mm ` +
        `${emuToMm(p.leftEmu)}mm`;
    }
    // A `noAutofit` box has a FIXED authored height; trailing empty
    // paragraphs (a bare paragraph mark + the style's default
    // spacing-after) add no content in Word but, rendered, push real
    // content past the box and into the next block. Drop them so the
    // text fits the box Word sized it to. Render-time only — the AST
    // keeps the paragraphs so export round-trips.
    const trimmed = prose ? dropTrailingEmptyParagraphs(tb.body) : tb.body;
    // Prepend the arrow(s) to the first prose textbox's first paragraph
    // so the ► sits inline before the title (cloned — don't mutate the AST).
    const body =
      i === 0 && leadingImages.length > 0 ? prependLeadingImages(trimmed, leadingImages) : trimmed;
    renderBody(body, region, numbering, styles, rawParts);
    wrapper.appendChild(region);
  });

  return wrapper;
}

/** Drop trailing paragraphs that carry no visible content (no runs, or
 *  only empty/whitespace text runs). A non-text run (drawing, break,
 *  field) counts as content and stops the trim. Returns a slice (or the
 *  same array when nothing trails) — never mutates the input. */
function dropTrailingEmptyParagraphs(blocks: Block[]): Block[] {
  let end = blocks.length;
  while (end > 0) {
    const b = blocks[end - 1]!;
    if (b.kind !== "paragraph" || !isBlankParagraph(b)) break;
    end--;
  }
  return end === blocks.length ? blocks : blocks.slice(0, end);
}

function isBlankParagraph(p: Paragraph): boolean {
  return p.runs.every((r) => r.kind === "text" && r.text.trim() === "");
}

/** Prepend inline images to the first paragraph in `blocks` (cloned, so
 *  the source AST isn't mutated). Pass-through when there's no paragraph. */
function prependLeadingImages(blocks: Block[], images: DrawingRun[]): Block[] {
  const idx = blocks.findIndex((b) => b.kind === "paragraph");
  if (idx === -1) return blocks;
  const target = blocks[idx] as Paragraph;
  const out = blocks.slice();
  out[idx] = { ...target, runs: [...images, ...target.runs] };
  return out;
}
