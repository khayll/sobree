/**
 * Serialize body `AnchoredFrame`s back to `<w:drawing><wp:anchor>` —
 * the inverse of `drawing/anchored.ts`. Each frame's anchor XML is
 * injected as a leading run of its host body paragraph
 * (`anchor.paragraphIndex`), which is where Word keeps anchors and
 * exactly where the importer's paragraph walk-up will find it again.
 *
 * Serialized: `picture`, `textbox`, `shape` (presets AND `a:custGeom`
 * from the stored SVG path) and `group` content (`wpg:wgp` with the
 * child coordinate system, children at their local offsets, nested
 * groups as `wpg:grpSp`); all three positioning forms (EMU offset /
 * align keyword / wp14 percent), percent sizes, wrap modes
 * (tight/through get a synthesized full-extent polygon — semantically
 * their rectangular degenerate, and the tag round-trips), text
 * distances and behindDoc.
 */

import type { AnchoredFrame, Block, SobreeDocument } from "../../doc/types";
import { NS } from "../shared/namespaces";
import { el, escapeXmlText } from "../shared/xml";
import { type ExportContext, allocImageRel, nextDocPr } from "./context";

/**
 * Block serializer for textbox bodies, injected by the caller
 * (`document.ts`) instead of imported — `anchors.ts` must not import
 * `document.ts`, which imports it back (the same cycle-break `table.ts`
 * uses for its cell renderer). The recursion is genuine (a textbox body
 * holds blocks); the import cycle isn't.
 */
export type RenderAnchorBlocks = (
  blocks: readonly Block[],
  ctx: ExportContext,
  doc: SobreeDocument,
) => string[];

/** Word 2010 drawing extensions (percent position / size forms). */
const NS_WP14 = "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing";

/**
 * Anchor XMLs grouped by host body-paragraph index. Frames whose content
 * this slice can't serialize are skipped (and stay covered by the
 * fixpoint's documented-gap transform). A frame without a
 * `paragraphIndex` (API-created, page-relative) anchors to paragraph 0 —
 * its position is page/margin-relative, so the host only decides which
 * page's flow carries it.
 */
export function anchorRunsByParagraph(
  doc: SobreeDocument,
  ctx: ExportContext,
  renderBlocks: RenderAnchorBlocks,
): Map<number, string> {
  return anchorRunsForFrames(doc.anchoredFrames ?? [], doc, ctx, renderBlocks);
}

/** Same grouping for an EXPLICIT frame list — header/footer parts pass
 *  their `doc.headerFooterFrames[partId]` set, keyed by PART-body
 *  paragraph indices (the space the header importer records). */
export function anchorRunsForFrames(
  frames: readonly AnchoredFrame[],
  doc: SobreeDocument,
  ctx: ExportContext,
  renderBlocks: RenderAnchorBlocks,
): Map<number, string> {
  const out = new Map<number, string>();
  for (const frame of frames) {
    const xml = renderAnchorRun(frame, ctx, doc, renderBlocks);
    if (!xml) continue;
    const idx = frame.anchor.paragraphIndex ?? 0;
    out.set(idx, (out.get(idx) ?? "") + xml);
  }
  return out;
}

/** Every content kind serializes; kept for callers that gate on it. */
export function isExportableAnchor(_frame: AnchoredFrame): boolean {
  return true;
}

function renderAnchorRun(
  frame: AnchoredFrame,
  ctx: ExportContext,
  doc: SobreeDocument,
  renderBlocks: RenderAnchorBlocks,
): string | null {
  if (!isExportableAnchor(frame)) return null;
  const graphicData = renderContent(frame, ctx, doc, renderBlocks);
  if (!graphicData) return null;

  // Distances / wrap are emitted only when the AST carries them — the
  // importer treats an ABSENT wrap element as "unknown" and reads
  // distances only under a wrap, so synthesizing defaults here would
  // round-trip as different (wrap: none + zero distances) frames.
  const dist = frame.textDistancesEmu;
  const anchor = el(
    "wp:anchor",
    {
      ...(dist
        ? {
            distT: dist.topEmu,
            distB: dist.bottomEmu,
            distL: dist.leftEmu,
            distR: dist.rightEmu,
          }
        : {}),
      simplePos: 0,
      relativeHeight: frame.zIndex ?? 0,
      behindDoc: frame.behindText ? 1 : 0,
      locked: 0,
      layoutInCell: 1,
      allowOverlap: 1,
    },
    [
      el("wp:simplePos", { x: 0, y: 0 }),
      renderPosition("H", frame),
      renderPosition("V", frame),
      el("wp:extent", { cx: frame.widthEmu, cy: frame.heightEmu }),
      renderWrap(frame),
      el("wp:docPr", {
        id: nextDocPr(ctx),
        name: `Frame ${frame.id}`,
        ...(frame.content.kind === "picture" && frame.content.altText
          ? { descr: escapeXmlText(frame.content.altText) }
          : {}),
      }),
      el("a:graphic", { "xmlns:a": NS.a }, graphicData),
      ...renderPctSize(frame),
    ].join(""),
  );
  return el("w:r", null, el("w:drawing", { "xmlns:wp": NS.wp }, anchor));
}

/**
 * One positioning form per axis, matching what the importer reads back:
 * percent (`wp14:pctPos*Offset`, 1/1000 of a percent) wins over an
 * alignment keyword, which wins over the EMU offset — the same
 * precedence `readAnchorOffset` resolves.
 */
function renderPosition(axis: "H" | "V", frame: AnchoredFrame): string {
  const relativeFrom = axis === "H" ? frame.anchor.horizontalFrom : frame.anchor.verticalFrom;
  const pct = axis === "H" ? frame.pctPosX : frame.pctPosY;
  const align = axis === "H" ? frame.alignH : frame.alignV;
  const offset = axis === "H" ? frame.offsetXEmu : frame.offsetYEmu;

  let form: string;
  if (pct !== undefined) {
    form = el(
      `wp14:pctPos${axis}Offset`,
      { "xmlns:wp14": NS_WP14 },
      String(Math.round(pct * 100000)),
    );
  } else if (align) {
    form = el("wp:align", null, align);
  } else {
    form = el("wp:posOffset", null, String(offset));
  }
  return el(`wp:position${axis}`, { relativeFrom }, form);
}

/** `wp14:sizeRelH/V` percent-size forms (siblings of the graphic). */
function renderPctSize(frame: AnchoredFrame): string[] {
  const out: string[] = [];
  if (frame.pctWidth !== undefined) {
    out.push(
      el(
        "wp14:sizeRelH",
        { "xmlns:wp14": NS_WP14, relativeFrom: frame.pctWidthFrom ?? "margin" },
        el("wp14:pctWidth", null, String(Math.round(frame.pctWidth * 100000))),
      ),
    );
  }
  if (frame.pctHeight !== undefined) {
    out.push(
      el(
        "wp14:sizeRelV",
        { "xmlns:wp14": NS_WP14, relativeFrom: frame.pctHeightFrom ?? "margin" },
        el("wp14:pctHeight", null, String(Math.round(frame.pctHeight * 100000))),
      ),
    );
  }
  return out;
}

/**
 * The `<wp:wrap*>` element. `tight` / `through` require a
 * `<wp:wrapPolygon>`; the AST doesn't model the polygon (the renderer
 * wraps rectangularly), so we synthesize the full-extent rectangle in
 * Word's 1/21600 polygon space — the rectangular degenerate of the
 * original outline. The wrap TAG round-trips; the outline precision was
 * already flattened at import.
 */
function renderWrap(frame: AnchoredFrame): string {
  const sideAttrs = frame.wrapText ? { wrapText: frame.wrapText } : { wrapText: "bothSides" };
  switch (frame.wrap) {
    case undefined:
      // The AST never saw a wrap element ("absent ⇒ unknown") — emit
      // none so the re-import sees the same absence.
      return "";
    case "square":
      return el("wp:wrapSquare", sideAttrs);
    case "topAndBottom":
      return el("wp:wrapTopAndBottom");
    case "tight":
    case "through": {
      const tag = frame.wrap === "tight" ? "wp:wrapTight" : "wp:wrapThrough";
      const box = [
        el("wp:start", { x: 0, y: 0 }),
        el("wp:lineTo", { x: 0, y: 21600 }),
        el("wp:lineTo", { x: 21600, y: 21600 }),
        el("wp:lineTo", { x: 21600, y: 0 }),
        el("wp:lineTo", { x: 0, y: 0 }),
      ].join("");
      return el(tag, sideAttrs, el("wp:wrapPolygon", { edited: 0 }, box));
    }
    default:
      return el("wp:wrapNone");
  }
}

// === content payloads ===

function renderContent(
  frame: AnchoredFrame,
  ctx: ExportContext,
  doc: SobreeDocument,
  renderBlocks: RenderAnchorBlocks,
): string | null {
  const c = frame.content;
  if (c.kind === "picture") {
    const rId = allocImageRel(ctx, c.partPath, doc);
    if (!rId) return null; // media bytes missing — drop rather than emit a dead rel
    return renderPictureData(frame, c.partPath, c.altText, rId, ctx);
  }
  if (c.kind === "textbox") return renderShapeData(frame, ctx, doc, true, renderBlocks);
  if (c.kind === "shape") return renderShapeData(frame, ctx, doc, false, renderBlocks);
  if (c.kind === "group") return renderGroupData(frame, ctx, doc, renderBlocks);
  return null;
}

/**
 * `<wpg:wgp>` group payload. The group's own `<a:xfrm>` carries the
 * rendered extent (`a:ext`) plus the CHILD coordinate system (`a:chExt`
 * origin `a:chOff`) that children's local offsets live in — exactly what
 * `parseGroup` reads back. Children render at their LOCAL boxes; a
 * nested group becomes `<wpg:grpSp>` with its own xfrm + coordinate
 * system, mirroring `synthFrameFromNestedGroup`.
 */
function renderGroupData(
  frame: AnchoredFrame,
  ctx: ExportContext,
  doc: SobreeDocument,
  renderBlocks: RenderAnchorBlocks,
): string | null {
  const c = frame.content;
  if (c.kind !== "group") return null;
  const inner = renderGroupShape("wpg:wgp", frameBox(frame), c, ctx, doc, renderBlocks);
  return el("a:graphicData", { uri: NS.wpg }, inner);
}

type GroupContent = Extract<AnchoredFrame["content"], { kind: "group" }>;

function renderGroupShape(
  tag: "wpg:wgp" | "wpg:grpSp",
  box: Box,
  group: GroupContent,
  ctx: ExportContext,
  doc: SobreeDocument,
  renderBlocks: RenderAnchorBlocks,
): string {
  const xfrmXml = el(
    "a:xfrm",
    null,
    [
      el("a:off", { x: box.x, y: box.y }),
      el("a:ext", { cx: box.cx, cy: box.cy }),
      el("a:chOff", { x: group.childCoordOffsetX ?? 0, y: group.childCoordOffsetY ?? 0 }),
      el("a:chExt", { cx: group.childCoordSystemCx, cy: group.childCoordSystemCy }),
    ].join(""),
  );
  const children = group.children
    .map((child) => renderGroupChild(child, ctx, doc, renderBlocks))
    .filter(Boolean)
    .join("");
  const parts = [
    el(tag === "wpg:wgp" ? "wpg:cNvGrpSpPr" : "wpg:cNvGrpSpPr"),
    el("wpg:grpSpPr", null, xfrmXml),
    children,
  ].join("");
  return tag === "wpg:wgp"
    ? el("wpg:wgp", { "xmlns:wpg": NS.wpg }, parts)
    : el("wpg:grpSp", null, parts);
}

/** One group child at its LOCAL box. `null` drops only a picture whose
 *  media bytes are missing (a dead rel would corrupt the package). */
function renderGroupChild(
  child: AnchoredFrame,
  ctx: ExportContext,
  doc: SobreeDocument,
  renderBlocks: RenderAnchorBlocks,
): string | null {
  const c = child.content;
  const box = localBox(child);
  if (c.kind === "picture") {
    const rId = allocImageRel(ctx, c.partPath, doc);
    if (!rId) return null;
    return renderPicElement(c.partPath, c.altText, rId, box, ctx);
  }
  if (c.kind === "textbox" || c.kind === "shape") {
    return renderWspElement(child, box, ctx, doc, renderBlocks);
  }
  if (c.kind === "group") {
    return renderGroupShape("wpg:grpSp", box, c, ctx, doc, renderBlocks);
  }
  return null;
}

/** Bare `<pic:pic>` at `box` — shared by anchored pictures, group
 *  children and inline-frame pictures. */
export function renderPicElement(
  partPath: string,
  altText: string | undefined,
  rId: string,
  box: Box,
  ctx: ExportContext,
): string {
  const id = nextDocPr(ctx);
  const nvPicPr = el(
    "pic:nvPicPr",
    null,
    `${el("pic:cNvPr", { id, name: partPath, descr: escapeXmlText(altText ?? "") })}${el("pic:cNvPicPr")}`,
  );
  const blipFill = el(
    "pic:blipFill",
    null,
    `${el("a:blip", { "r:embed": rId })}${el("a:stretch", null, el("a:fillRect"))}`,
  );
  const spPr = el(
    "pic:spPr",
    null,
    `${xfrm(box)}${el("a:prstGeom", { prst: "rect" }, el("a:avLst"))}`,
  );
  return el("pic:pic", { "xmlns:pic": NS.pic }, `${nvPicPr}${blipFill}${spPr}`);
}

function renderPictureData(
  frame: AnchoredFrame,
  partPath: string,
  altText: string | undefined,
  rId: string,
  ctx: ExportContext,
): string {
  const pic = renderPicElement(partPath, altText, rId, frameBox(frame), ctx);
  return el("a:graphicData", { uri: NS.pic }, pic);
}

function renderShapeData(
  frame: AnchoredFrame,
  ctx: ExportContext,
  doc: SobreeDocument,
  _isTextbox: boolean,
  renderBlocks: RenderAnchorBlocks,
): string {
  const wsp = renderWspElement(frame, frameBox(frame), ctx, doc, renderBlocks);
  return el("a:graphicData", { uri: NS.wps }, wsp);
}

/**
 * `<wps:wsp>` for both textboxes and geometric shapes at `box` — the
 * shape kind decides the geometry (`a:prstGeom` for presets,
 * `a:custGeom` re-built from the stored SVG path for custom outlines),
 * the textbox adds `wps:txbx` + `wps:bodyPr`.
 */
function renderWspElement(
  frame: AnchoredFrame,
  box: Box,
  ctx: ExportContext,
  doc: SobreeDocument,
  renderBlocks: RenderAnchorBlocks,
): string {
  const c = frame.content;
  const isTextbox = c.kind === "textbox";
  const fill = c.kind === "textbox" || c.kind === "shape" ? c.fill : undefined;
  const border = c.kind === "textbox" || c.kind === "shape" ? c.border : undefined;

  let geometryXml: string;
  if (c.kind === "shape" && c.geometry === "custom" && c.path) {
    geometryXml = custGeom(c.path);
  } else {
    const preset =
      c.kind === "textbox"
        ? (c.geometry ?? "rect")
        : c.kind === "shape" && c.geometry !== "custom"
          ? c.geometry
          : "rect";
    geometryXml = prstGeom(preset);
  }

  const spPrChildren = [xfrm(box), geometryXml, solidFill(fill), outline(border)]
    .filter(Boolean)
    .join("");

  const parts = [
    el("wps:cNvPr", { id: nextDocPr(ctx), name: `Frame ${frame.id}` }),
    el("wps:cNvSpPr", isTextbox ? { txBox: 1 } : null),
    el("wps:spPr", null, spPrChildren),
  ];

  if (isTextbox && c.kind === "textbox") {
    const body = renderBlocks(c.body, ctx, doc);
    if (body.length === 0) body.push(el("w:p"));
    parts.push(el("wps:txbx", null, el("w:txbxContent", null, body)));
    const pad = c.padding;
    parts.push(
      el(
        "wps:bodyPr",
        pad
          ? {
              lIns: pad.leftEmu,
              tIns: pad.topEmu,
              rIns: pad.rightEmu,
              bIns: pad.bottomEmu,
            }
          : null,
      ),
    );
  } else {
    parts.push(el("wps:bodyPr"));
  }

  return el("wps:wsp", { "xmlns:wps": NS.wps }, parts.join(""));
}

/**
 * `<a:custGeom>` re-built from the stored SVG path — the inverse of
 * `customGeometry.ts`, whose output grammar is exactly `M x y`, `L x y`,
 * `C x1 y1 x2 y2 x y`, `Q x1 y1 x y` and `Z`, space-separated absolute
 * integer commands. Anything else (never produced by our importer) is
 * skipped, mirroring the importer's own skip-unknown-segment policy.
 */
export function custGeom(path: { widthEmu: number; heightEmu: number; d: string }): string {
  const tokens = path.d.trim().split(/\s+/);
  const commands: string[] = [];
  const pt = (x: string | undefined, y: string | undefined): string | null => {
    if (x === undefined || y === undefined) return null;
    return el("a:pt", { x, y });
  };
  let i = 0;
  while (i < tokens.length) {
    const op = tokens[i];
    if (op === "M" || op === "L") {
      const p1 = pt(tokens[i + 1], tokens[i + 2]);
      if (p1) commands.push(el(op === "M" ? "a:moveTo" : "a:lnTo", null, p1));
      i += 3;
    } else if (op === "C") {
      const ps = [
        pt(tokens[i + 1], tokens[i + 2]),
        pt(tokens[i + 3], tokens[i + 4]),
        pt(tokens[i + 5], tokens[i + 6]),
      ];
      if (ps.every(Boolean)) commands.push(el("a:cubicBezTo", null, ps.join("")));
      i += 7;
    } else if (op === "Q") {
      const ps = [pt(tokens[i + 1], tokens[i + 2]), pt(tokens[i + 3], tokens[i + 4])];
      if (ps.every(Boolean)) commands.push(el("a:quadBezTo", null, ps.join("")));
      i += 5;
    } else if (op === "Z") {
      commands.push(el("a:close"));
      i += 1;
    } else {
      i += 1; // unknown token — skip, keep the rest of the shape
    }
  }
  const pathEl = el("a:path", { w: path.widthEmu, h: path.heightEmu }, commands.join(""));
  return el("a:custGeom", null, `${el("a:avLst")}${el("a:pathLst", null, pathEl)}`);
}

/** `<a:xfrm>` for a shape/picture at `box` — group children pass their
 *  LOCAL offsets, top-level frames sit at (0,0) in their own extent. */
function xfrm(box: Box): string {
  return el(
    "a:xfrm",
    null,
    `${el("a:off", { x: box.x, y: box.y })}${el("a:ext", { cx: box.cx, cy: box.cy })}`,
  );
}

/** Placement box in the current coordinate space (EMU). */
export interface Box {
  x: number;
  y: number;
  cx: number;
  cy: number;
}

function frameBox(frame: AnchoredFrame): Box {
  return { x: 0, y: 0, cx: frame.widthEmu, cy: frame.heightEmu };
}

function localBox(frame: AnchoredFrame): Box {
  return { x: frame.offsetXEmu, y: frame.offsetYEmu, cx: frame.widthEmu, cy: frame.heightEmu };
}

/** Preset geometry — the inverse of `readGeometry`'s coercions. */
function prstGeom(geometry: "rect" | "ellipse" | "roundedRect" | "line"): string {
  const prst =
    geometry === "ellipse"
      ? "ellipse"
      : geometry === "roundedRect"
        ? "roundRect"
        : geometry === "line"
          ? "line"
          : "rect";
  return el("a:prstGeom", { prst }, el("a:avLst"));
}

function solidFill(fill: string | undefined): string {
  if (!fill) return "";
  return el("a:solidFill", null, el("a:srgbClr", { val: fill.replace(/^#/, "") }));
}

/** `<a:ln>` — the inverse of `readBorder` / `coerceBorderStyle`. `double`
 *  can't originate from a DrawingML import (the reader never returns it);
 *  emit it as solid rather than invent a dash pattern. */
function outline(border: { color: string; widthEmu: number; style: string } | undefined): string {
  if (!border) return "";
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
