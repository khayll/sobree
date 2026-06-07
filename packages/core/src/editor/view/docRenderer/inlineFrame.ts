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

import { emuToMm } from "./units";
import { partPathToUrl } from "./inline";
import { applyParagraphProps } from "./properties";
import type {
  Block,
  DrawingRun,
  InlineFrame,
  Paragraph,
  NamedStyle,
  NumberingDefinition,
} from "../../../doc/types";

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
  wrapper.style.minHeight = `${emuToMm(frame.sizeEmu.hEmu)}mm`;
  // `.paper-content` is a flex column, so the frame is a flex item. Our
  // explicit `min-height` above overrides the flex default `min-height:
  // auto`, which would otherwise let the flex algorithm SHRINK the frame
  // below its content when the page overflows — its in-flow textboxes then
  // spill out and overlap the next block. `flex-shrink: 0` keeps the frame
  // at its true content height.
  wrapper.style.flexShrink = "0";
  if (frame.pageBreakBefore) wrapper.setAttribute("data-page-break-before", "");
  if (frame.keepNext) wrapper.setAttribute("data-keep-next", "");

  // Scale child decorations from the group's local coord system into
  // the wrapper's rendered size. Horizontal axis uses 100% width
  // relative to the content area; vertical uses sizeEmu in mm.
  const scaleX = frame.groupExtentEmu.wEmu > 0 ? 1 / frame.groupExtentEmu.wEmu : 0;

  // A group with multiple textboxes (a "Project: X" entry: title + details)
  // — or a single textbox with no decoration (a project detail block) — is
  // PROSE: render its textboxes stacked IN FLOW (content-sized, no clip,
  // per the textbox-only path) and carry the group's picture (the ► arrow)
  // as a LEADING INLINE IMAGE on the first textbox so it sits beside the
  // title. A single textbox OVER a picture/shape is a DECORATIVE pill —
  // keep the absolute fixed-height overlay (the textbox sits on top).
  const prose =
    frame.textboxes.length > 1 ||
    (frame.textboxes.length === 1 &&
      frame.pictures.length === 0 &&
      frame.shapes.length === 0);

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
      img.style.left = `${pic.offsetEmu.xEmu * scaleX * 100}%`;
      img.style.top = `${emuToMm(pic.offsetEmu.yEmu)}mm`;
      img.style.width = `${pic.sizeEmu.wEmu * scaleX * 100}%`;
      img.style.height = `${emuToMm(pic.sizeEmu.hEmu)}mm`;
      img.style.objectFit = "fill";
      wrapper.appendChild(img);
    }
  }

  for (const shape of frame.shapes) {
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.left = `${shape.offsetEmu.xEmu * scaleX * 100}%`;
    el.style.top = `${emuToMm(shape.offsetEmu.yEmu)}mm`;
    el.style.width = `${shape.sizeEmu.wEmu * scaleX * 100}%`;
    el.style.height = `${emuToMm(shape.sizeEmu.hEmu)}mm`;
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
    ? frame.pictures.map((pic): DrawingRun => ({
        kind: "drawing",
        partPath: pic.partPath,
        widthEmu: Math.round(pic.sizeEmu.wEmu * sx),
        heightEmu: Math.round(pic.sizeEmu.hEmu * sy),
        placement: "inline",
        // Centre the arrow on the title line (it's taller than the text).
        verticalAlign: "middle",
        ...(pic.altText !== undefined ? { altText: pic.altText } : {}),
      }))
    : [];

  frame.textboxes.forEach((tb, i) => {
    const region = document.createElement("div");
    if (prose) {
      // Content-sized, in flow: declared height is a floor; longer prose
      // grows the region (and the wrapper) instead of clipping. Single-
      // textbox frames keep their vertical offset; stacked multi-textbox
      // frames flow naturally (each one's own offset would mis-space them).
      region.style.marginLeft = `${tb.offsetEmu.xEmu * scaleX * 100}%`;
      if (frame.textboxes.length === 1 && tb.offsetEmu.yEmu > 0) {
        region.style.marginTop = `${emuToMm(tb.offsetEmu.yEmu)}mm`;
      }
      region.style.width = `${tb.sizeEmu.wEmu * scaleX * 100}%`;
      region.style.minHeight = `${emuToMm(tb.sizeEmu.hEmu)}mm`;
    } else {
      // Decorative overlay: absolute, fixed height, clipped (pill heading).
      region.style.position = "absolute";
      region.style.left = `${tb.offsetEmu.xEmu * scaleX * 100}%`;
      region.style.top = `${emuToMm(tb.offsetEmu.yEmu)}mm`;
      region.style.width = `${tb.sizeEmu.wEmu * scaleX * 100}%`;
      region.style.height = `${emuToMm(tb.sizeEmu.hEmu)}mm`;
      region.style.overflow = "hidden";
    }
    region.style.boxSizing = "border-box";
    // Honour the textbox's vertical anchor (`<wps:bodyPr anchor>`): a
    // flex column whose justification places the body at top / centre /
    // bottom of the region. Word relies on this to vertically centre a
    // single heading line inside the section pills.
    region.style.display = "flex";
    region.style.flexDirection = "column";
    region.style.justifyContent =
      tb.vAlign === "center"
        ? "center"
        : tb.vAlign === "bottom"
          ? "flex-end"
          : "flex-start";
    if (tb.fill) region.style.background = tb.fill;
    if (tb.padding) {
      const p = tb.padding;
      region.style.padding =
        `${emuToMm(p.topEmu)}mm ` +
        `${emuToMm(p.rightEmu)}mm ` +
        `${emuToMm(p.bottomEmu)}mm ` +
        `${emuToMm(p.leftEmu)}mm`;
    }
    // Prepend the arrow(s) to the first prose textbox's first paragraph
    // so the ► sits inline before the title (cloned — don't mutate the AST).
    const body =
      i === 0 && leadingImages.length > 0
        ? prependLeadingImages(tb.body, leadingImages)
        : tb.body;
    renderBody(body, region, numbering, styles, rawParts);
    wrapper.appendChild(region);
  });

  return wrapper;
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
