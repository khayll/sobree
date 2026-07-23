/**
 * Serialize `inline_frame` blocks — the inverse of `drawing/inline.ts`
 * and, for picture-only bands, of `import/imageBands.ts`.
 *
 * An InlineFrame has two provenances with two faithful wire forms:
 *
 *   - **Textbox-carrying groups** (a "pill" heading, a Project entry)
 *     came from a real `<wp:inline><wpg:wgp>` — re-emitted as exactly
 *     that. `parseInlineFrames` claims a group only when it holds a
 *     textbox, so this form round-trips through the same reader.
 *
 *   - **Picture-only frames** were SYNTHESIZED by `imageBands.ts` from
 *     N ≥ 2 square-wrapped `<wp:anchor>` pictures sharing an empty
 *     anchor paragraph. The faithful inverse is those anchors: emitted
 *     at the band's intra-group offsets (column/paragraph-relative,
 *     square wrap) on an empty host paragraph, the band pass re-groups
 *     them into the identical InlineFrame on import (offsets are
 *     already bounding-box-normalized, so re-normalizing is a no-op).
 *
 *   - Shape-only frames (no textbox, no picture) have no reader that
 *     reclaims them — they stay a documented gap and emit nothing.
 */

import type { InlineFrame, SobreeDocument } from "../../doc/types";
import { NS } from "../shared/namespaces";
import { el, escapeXmlText } from "../shared/xml";
import { type RenderAnchorBlocks, renderPicElement } from "./anchors";
import { type ExportContext, allocImageRel, nextDocPr } from "./context";

/**
 * The run XML(s) for an inline frame's host paragraph, or `null` for the
 * shape-only gap (caller then emits nothing for the block, mirroring the
 * pre-export drop the fixpoint documents).
 */
export function renderInlineFrameRuns(
  frame: InlineFrame,
  ctx: ExportContext,
  doc: SobreeDocument,
  renderBlocks: RenderAnchorBlocks,
): string | null {
  if (frame.textboxes.length > 0) return renderInlineGroupRun(frame, ctx, doc, renderBlocks);
  if (frame.pictures.length > 0) return renderBandAnchorRuns(frame, ctx, doc);
  return null;
}

/** `<w:r><w:drawing><wp:inline><wpg:wgp>…` — the textbox-group form. */
function renderInlineGroupRun(
  frame: InlineFrame,
  ctx: ExportContext,
  doc: SobreeDocument,
  renderBlocks: RenderAnchorBlocks,
): string {
  const children: string[] = [];
  for (const tb of frame.textboxes) {
    children.push(renderTextboxWsp(tb, ctx, doc, renderBlocks));
  }
  for (const pic of frame.pictures) {
    const rId = allocImageRel(ctx, pic.partPath, doc);
    if (!rId) continue;
    children.push(
      renderPicElement(
        pic.partPath,
        pic.altText,
        rId,
        {
          x: pic.offsetEmu.xEmu,
          y: pic.offsetEmu.yEmu,
          cx: pic.sizeEmu.wEmu,
          cy: pic.sizeEmu.hEmu,
        },
        ctx,
      ),
    );
  }
  for (const shape of frame.shapes) {
    children.push(renderShapeWsp(shape, ctx));
  }

  const xfrm = el(
    "a:xfrm",
    null,
    [
      el("a:off", { x: 0, y: 0 }),
      el("a:ext", { cx: frame.sizeEmu.wEmu, cy: frame.sizeEmu.hEmu }),
      el("a:chOff", { x: 0, y: 0 }),
      el("a:chExt", { cx: frame.groupExtentEmu.wEmu, cy: frame.groupExtentEmu.hEmu }),
    ].join(""),
  );
  const wgp = el(
    "wpg:wgp",
    { "xmlns:wpg": NS.wpg },
    `${el("wpg:cNvGrpSpPr")}${el("wpg:grpSpPr", null, xfrm)}${children.join("")}`,
  );
  const graphic = el("a:graphic", { "xmlns:a": NS.a }, el("a:graphicData", { uri: NS.wpg }, wgp));
  const inline = el(
    "wp:inline",
    { distT: 0, distB: 0, distL: 0, distR: 0 },
    [
      el("wp:extent", { cx: frame.sizeEmu.wEmu, cy: frame.sizeEmu.hEmu }),
      el("wp:docPr", { id: nextDocPr(ctx), name: "Inline group" }),
      graphic,
    ].join(""),
  );
  return el("w:r", null, el("w:drawing", { "xmlns:wp": NS.wp }, inline));
}

function renderTextboxWsp(
  tb: InlineFrame["textboxes"][number],
  ctx: ExportContext,
  doc: SobreeDocument,
  renderBlocks: RenderAnchorBlocks,
): string {
  const spPr = el(
    "wps:spPr",
    null,
    [
      el(
        "a:xfrm",
        null,
        `${el("a:off", { x: tb.offsetEmu.xEmu, y: tb.offsetEmu.yEmu })}${el("a:ext", { cx: tb.sizeEmu.wEmu, cy: tb.sizeEmu.hEmu })}`,
      ),
      el("a:prstGeom", { prst: "rect" }, el("a:avLst")),
      tb.fill ? el("a:solidFill", null, el("a:srgbClr", { val: tb.fill.replace(/^#/, "") })) : "",
      tb.border ? borderLn(tb.border) : "",
    ]
      .filter(Boolean)
      .join(""),
  );
  const body = renderBlocks(tb.body, ctx, doc);
  if (body.length === 0) body.push(el("w:p"));
  // bodyPr only when the source had one (padding/vAlign are always both
  // set by the reader when it did) — emitting a bare bodyPr would
  // round-trip as Word-default padding the original never declared.
  let bodyPr = "";
  if (tb.padding || tb.vAlign || tb.autoFit) {
    const attrs: Record<string, string | number> = {};
    if (tb.padding) {
      attrs.lIns = tb.padding.leftEmu;
      attrs.tIns = tb.padding.topEmu;
      attrs.rIns = tb.padding.rightEmu;
      attrs.bIns = tb.padding.bottomEmu;
    }
    if (tb.vAlign === "center") attrs.anchor = "ctr";
    else if (tb.vAlign === "bottom") attrs.anchor = "b";
    bodyPr = el("wps:bodyPr", attrs, tb.autoFit ? el("a:spAutoFit") : null);
  }
  return el(
    "wps:wsp",
    { "xmlns:wps": NS.wps },
    [
      el("wps:cNvPr", { id: nextDocPr(ctx), name: "Text box" }),
      el("wps:cNvSpPr", { txBox: 1 }),
      spPr,
      el("wps:txbx", null, el("w:txbxContent", null, body)),
      bodyPr,
    ].join(""),
  );
}

function renderShapeWsp(shape: InlineFrame["shapes"][number], ctx: ExportContext): string {
  const prst =
    shape.geometry === "ellipse"
      ? "ellipse"
      : shape.geometry === "roundedRect"
        ? "roundRect"
        : shape.geometry === "line"
          ? "line"
          : "rect";
  const spPr = el(
    "wps:spPr",
    null,
    [
      el(
        "a:xfrm",
        null,
        `${el("a:off", { x: shape.offsetEmu.xEmu, y: shape.offsetEmu.yEmu })}${el("a:ext", { cx: shape.sizeEmu.wEmu, cy: shape.sizeEmu.hEmu })}`,
      ),
      el("a:prstGeom", { prst }, el("a:avLst")),
      shape.fill
        ? el("a:solidFill", null, el("a:srgbClr", { val: shape.fill.replace(/^#/, "") }))
        : "",
      shape.border ? borderLn(shape.border) : "",
    ]
      .filter(Boolean)
      .join(""),
  );
  return el(
    "wps:wsp",
    { "xmlns:wps": NS.wps },
    `${el("wps:cNvPr", { id: nextDocPr(ctx), name: "Shape" })}${el("wps:cNvSpPr")}${spPr}${el("wps:bodyPr")}`,
  );
}

function borderLn(border: { color: string; widthEmu: number; style: string }): string {
  const dash =
    border.style === "dashed"
      ? el("a:prstDash", { val: "dash" })
      : border.style === "dotted"
        ? el("a:prstDash", { val: "sysDot" })
        : "";
  return el(
    "a:ln",
    border.widthEmu > 0 ? { w: border.widthEmu } : null,
    `${el("a:solidFill", null, el("a:srgbClr", { val: border.color.replace(/^#/, "") }))}${dash}`,
  );
}

/**
 * The band inverse: one square-wrapped `<wp:anchor>` picture run per band
 * member, at its intra-band offsets (column/paragraph-relative — the
 * shared coordinate origin `imageBands` requires). Re-importing runs the
 * band pass on the empty host paragraph and re-synthesizes the identical
 * InlineFrame: offsets are already bounding-box-normalized, so the
 * reconstruction's own normalization is a no-op.
 */
function renderBandAnchorRuns(
  frame: InlineFrame,
  ctx: ExportContext,
  doc: SobreeDocument,
): string | null {
  const runs: string[] = [];
  for (const pic of frame.pictures) {
    const rId = allocImageRel(ctx, pic.partPath, doc);
    if (!rId) continue;
    const picXml = renderPicElement(
      pic.partPath,
      pic.altText,
      rId,
      { x: 0, y: 0, cx: pic.sizeEmu.wEmu, cy: pic.sizeEmu.hEmu },
      ctx,
    );
    const anchor = el(
      "wp:anchor",
      {
        simplePos: 0,
        relativeHeight: 0,
        behindDoc: 0,
        locked: 0,
        layoutInCell: 1,
        allowOverlap: 1,
      },
      [
        el("wp:simplePos", { x: 0, y: 0 }),
        el(
          "wp:positionH",
          { relativeFrom: "column" },
          el("wp:posOffset", null, String(pic.offsetEmu.xEmu)),
        ),
        el(
          "wp:positionV",
          { relativeFrom: "paragraph" },
          el("wp:posOffset", null, String(pic.offsetEmu.yEmu)),
        ),
        el("wp:extent", { cx: pic.sizeEmu.wEmu, cy: pic.sizeEmu.hEmu }),
        el("wp:wrapSquare", { wrapText: "bothSides" }),
        el("wp:docPr", {
          id: nextDocPr(ctx),
          name: pic.partPath,
          ...(pic.altText ? { descr: escapeXmlText(pic.altText) } : {}),
        }),
        el("a:graphic", { "xmlns:a": NS.a }, el("a:graphicData", { uri: NS.pic }, picXml)),
      ].join(""),
    );
    runs.push(el("w:r", null, el("w:drawing", { "xmlns:wp": NS.wp }, anchor)));
  }
  return runs.length > 0 ? runs.join("") : null;
}
