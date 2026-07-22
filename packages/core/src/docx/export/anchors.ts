/**
 * Serialize body `AnchoredFrame`s back to `<w:drawing><wp:anchor>` —
 * the inverse of `drawing/anchored.ts`. Each frame's anchor XML is
 * injected as a leading run of its host body paragraph
 * (`anchor.paragraphIndex`), which is where Word keeps anchors and
 * exactly where the importer's paragraph walk-up will find it again.
 *
 * Serialized in this slice: `picture`, `textbox` and PRESET-geometry
 * `shape` content, all three positioning forms (EMU offset / align
 * keyword / wp14 percent), percent sizes, wrap modes (tight/through get
 * a synthesized full-extent polygon — semantically their rectangular
 * degenerate, and the tag round-trips), text distances and behindDoc.
 *
 * Still on the audited gap list (see `feature.exportFixpoint.test.ts`):
 * `group` content, custom-geometry shapes, and `headerFooterFrames`.
 */

import type { AnchoredFrame, SobreeDocument } from "../../doc/types";
import { NS } from "../shared/namespaces";
import { el, escapeXmlText } from "../shared/xml";
import { type ExportContext, allocImageRel, nextDocPr } from "./context";
import { renderBlocks } from "./document";

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
): Map<number, string> {
  const out = new Map<number, string>();
  for (const frame of doc.anchoredFrames ?? []) {
    const xml = renderAnchorRun(frame, ctx, doc);
    if (!xml) continue;
    const idx = frame.anchor.paragraphIndex ?? 0;
    out.set(idx, (out.get(idx) ?? "") + xml);
  }
  return out;
}

/** `true` when this slice can serialize the frame's content. */
export function isExportableAnchor(frame: AnchoredFrame): boolean {
  const c = frame.content;
  if (c.kind === "picture") return true;
  if (c.kind === "textbox") return true;
  if (c.kind === "shape") return c.geometry !== "custom";
  return false;
}

function renderAnchorRun(
  frame: AnchoredFrame,
  ctx: ExportContext,
  doc: SobreeDocument,
): string | null {
  if (!isExportableAnchor(frame)) return null;
  const graphicData = renderContent(frame, ctx, doc);
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
): string | null {
  const c = frame.content;
  if (c.kind === "picture") {
    const rId = allocImageRel(ctx, c.partPath, doc);
    if (!rId) return null; // media bytes missing — drop rather than emit a dead rel
    return renderPictureData(frame, c.partPath, c.altText, rId, ctx);
  }
  if (c.kind === "textbox") return renderShapeData(frame, ctx, doc, true);
  if (c.kind === "shape" && c.geometry !== "custom") return renderShapeData(frame, ctx, doc, false);
  return null;
}

function renderPictureData(
  frame: AnchoredFrame,
  partPath: string,
  altText: string | undefined,
  rId: string,
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
    `${xfrm(frame)}${el("a:prstGeom", { prst: "rect" }, el("a:avLst"))}`,
  );
  const pic = el("pic:pic", { "xmlns:pic": NS.pic }, `${nvPicPr}${blipFill}${spPr}`);
  return el("a:graphicData", { uri: NS.pic }, pic);
}

/** `<wps:wsp>` for both textboxes and geometric shapes — the shape kind
 *  decides the prstGeom, the textbox adds `wps:txbx` + `wps:bodyPr`. */
function renderShapeData(
  frame: AnchoredFrame,
  ctx: ExportContext,
  doc: SobreeDocument,
  isTextbox: boolean,
): string {
  const c = frame.content;
  // `custom` is unreachable here (renderContent declines it) — the
  // narrowing is for the type system, not a real fallback.
  const geometry =
    c.kind === "textbox"
      ? (c.geometry ?? "rect")
      : c.kind === "shape" && c.geometry !== "custom"
        ? c.geometry
        : "rect";
  const fill = c.kind === "textbox" || c.kind === "shape" ? c.fill : undefined;
  const border = c.kind === "textbox" || c.kind === "shape" ? c.border : undefined;

  const spPrChildren = [xfrm(frame), prstGeom(geometry), solidFill(fill), outline(border)]
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

  const wsp = el("wps:wsp", { "xmlns:wps": NS.wps }, parts.join(""));
  return el("a:graphicData", { uri: NS.wps }, wsp);
}

function xfrm(frame: AnchoredFrame): string {
  return el(
    "a:xfrm",
    null,
    `${el("a:off", { x: 0, y: 0 })}${el("a:ext", { cx: frame.widthEmu, cy: frame.heightEmu })}`,
  );
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
