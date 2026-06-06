/**
 * Parse `<w:drawing>` / `<w:pict>` anchored objects out of a document
 * XML and return them as a flat list of `AnchoredFrame`s.
 *
 * Sobree's older "lifter" architecture exploded anchored textboxes into
 * synthetic body paragraphs carrying `liftedFromTextBox` metadata, then
 * had the renderer reconstruct floating layout from per-paragraph
 * coordinates. That broke selection, broke multi-shape groups, and
 * coupled the paginator to absolute-positioned content it should never
 * have seen. This module returns frames as their own AST objects;
 * the renderer paints them into a per-paper overlay layer.
 *
 * What we DO parse:
 *   - `<w:drawing><wp:anchor>`           → top-level AnchoredFrame
 *   - `<wpg:wgp>` inside an anchor       → AnchoredContent of kind "group"
 *   - `<wps:wsp>` with `<wps:txbx>`      → "textbox" content
 *   - `<wps:wsp>` with `<wps:spPr>`-only → "shape" content (rect / ellipse)
 *   - `<pic:pic>`                        → "picture" content
 *
 * What we do NOT parse here (yet):
 *   - `<wp:inline>` inline drawings — those stay as `DrawingRun`s in
 *     paragraph runs, handled by the inline-run parser.
 *   - `<w:pict>` VML — covered by a separate fallback path in a
 *     follow-up step; same return type so the renderer is oblivious.
 *
 * Pure function. No side effects on the input XML. The lifter (legacy)
 * still runs alongside during Phase A; Phase B will delete it after
 * the renderer is verified working off this output.
 */

import type {
  AnchoredContent,
  AnchoredFrame,
  AnchorOrigin,
  Block,
} from "../../doc/types";
import { NS } from "../shared/namespaces";

export interface AnchoredFramesContext {
  /** RelationshipId → part path lookup, e.g. `"rId4" → "media/image1.png"`. */
  rels: Map<string, string>;
  /**
   * Importer's body-block list AT THE TIME this function runs. Used to
   * resolve `paragraphIndex` for the AnchorOrigin: each frame is
   * attributed to the body paragraph that contained its `<w:drawing>`,
   * so the renderer knows which page receives the frame after
   * pagination. May be empty during early-pass parsing; callers can
   * pass `[]` and the renderer will treat all frames as section-relative.
   */
  bodyParagraphIndexByElement?: Map<Element, number>;
  /**
   * Recursive body walker for `<w:txbxContent>`, injected by the caller
   * to avoid an `anchoredFrames ↔ document` import cycle. When present,
   * textbox bodies parse through the SAME pipeline as the document body
   * — real run formatting, paragraph spacing, lists, tables — so a
   * frame whose content flows into the body (see `flowFrames`) keeps
   * its true layout. When absent, falls back to flat text (tests).
   */
  parseBlockBody?: (txbxContent: Element) => Block[];
}

/**
 * Walk every `<w:drawing>/<wp:anchor>` in the document and return one
 * `AnchoredFrame` per top-level anchored drawing. The returned list is
 * in document order, which matters for z-stacking when frames
 * overlap (later siblings paint on top).
 *
 * The frame's `id` is deterministic: `"anchor-{N}"` where N is its
 * document-order index. Selection / persistence rely on this being
 * stable across re-imports of the same source.
 */
export function parseAnchoredFrames(
  xmlDoc: Document,
  ctx: AnchoredFramesContext,
  claim = true,
): AnchoredFrame[] {
  const out: AnchoredFrame[] = [];
  const claimed: Element[] = [];
  const drawings = Array.from(xmlDoc.getElementsByTagNameNS(NS.w, "drawing"));
  let counter = 0;
  for (const drawing of drawings) {
    const anchor = firstChildNS(drawing, NS.wp, "anchor");
    if (!anchor) continue; // Inline drawings handled elsewhere.
    const frame = parseAnchoredFrame(anchor, drawing, ctx, () => `anchor-${counter++}`);
    if (frame) {
      out.push(frame);
      claimed.push(drawing);
    }
  }
  // Claim pass: remove each successfully-parsed anchored drawing from
  // the XML so the legacy `liftTextBoxContent` can't also lift its
  // textbox content into body flow (which would double-render the
  // text — once in the floating anchor layer, once in the body).
  // Anchored content belongs in the floating overlay, not in flow.
  // `claim: false` lets unit tests inspect frames without mutating XML.
  if (claim) {
    for (const drawing of claimed) drawing.parentNode?.removeChild(drawing);
  }
  return out;
}

// === implementation ===

function parseAnchoredFrame(
  anchor: Element,
  drawing: Element,
  ctx: AnchoredFramesContext,
  nextId: () => string,
): AnchoredFrame | null {
  const origin = readAnchorOrigin(anchor, drawing, ctx);
  const extent = firstChildNS(anchor, NS.wp, "extent");
  if (!extent) return null;
  const widthEmu = numAttr(extent, "cx");
  const heightEmu = numAttr(extent, "cy");
  if (widthEmu <= 0 || heightEmu <= 0) return null;

  const offset = readAnchorOffset(anchor);

  const graphicData = anchor.getElementsByTagNameNS(NS.a, "graphicData")[0];
  if (!graphicData) return null;
  const content = parseGraphicData(graphicData, ctx, nextId);
  if (!content) return null;

  const behindAttr = anchor.getAttribute("behindDoc");
  const out: AnchoredFrame = {
    id: nextId(),
    anchor: origin,
    offsetXEmu: offset.x,
    offsetYEmu: offset.y,
    widthEmu,
    heightEmu,
    content,
  };
  if (behindAttr === "1" || behindAttr === "true") out.behindText = true;
  const wrap = readWrapType(anchor);
  if (wrap) out.wrap = wrap;
  return out;
}

/**
 * The text-wrap mode lives as a dedicated child of `<wp:anchor>`:
 * `<wp:wrapSquare>`, `<wp:wrapTopAndBottom>`, `<wp:wrapTight>`,
 * `<wp:wrapThrough>`, or `<wp:wrapNone>`. Returns the mapped enum or
 * `undefined` when no wrap element is present.
 */
function readWrapType(anchor: Element): AnchoredFrame["wrap"] | undefined {
  for (const child of Array.from(anchor.children)) {
    if (child.namespaceURI !== NS.wp) continue;
    switch (child.localName) {
      case "wrapSquare":
        return "square";
      case "wrapTopAndBottom":
        return "topAndBottom";
      case "wrapTight":
        return "tight";
      case "wrapThrough":
        return "through";
      case "wrapNone":
        return "none";
    }
  }
  return undefined;
}

function parseGraphicData(
  graphicData: Element,
  ctx: AnchoredFramesContext,
  nextId: () => string,
): AnchoredContent | null {
  // Three possible shapes:
  //   1. <wpg:wgp>        → group of children
  //   2. <wps:wsp>        → single shape (textbox or geometric)
  //   3. <pic:pic>        → single picture
  // We probe in that order and return the first match.
  const wpg = firstChildNS(graphicData, NS.wpg, "wgp");
  if (wpg) return parseGroup(wpg, ctx, nextId);

  const wsp = firstChildNS(graphicData, NS.wps, "wsp");
  if (wsp) return parseShape(wsp, ctx);

  const pic = firstChildNS(graphicData, NS.pic, "pic");
  if (pic) return parsePicture(pic, ctx);

  return null;
}

function parseGroup(
  wpg: Element,
  ctx: AnchoredFramesContext,
  nextId: () => string,
): AnchoredContent {
  // The group's own coordinate-system extent lives on
  // `<wpg:grpSpPr><a:xfrm><a:chExt cx cy>`. Children's offsets are
  // expressed in this space, then the group itself can be drawn at
  // any size — the renderer scales.
  const grpSpPr = firstChildNS(wpg, NS.wpg, "grpSpPr");
  const xfrm = grpSpPr ? grpSpPr.getElementsByTagNameNS(NS.a, "xfrm")[0] : undefined;
  const chExt = xfrm ? xfrm.getElementsByTagNameNS(NS.a, "chExt")[0] : undefined;
  const childCoordSystemCx = chExt ? numAttr(chExt, "cx") : 0;
  const childCoordSystemCy = chExt ? numAttr(chExt, "cy") : 0;

  const children: AnchoredFrame[] = [];
  for (const child of Array.from(wpg.children)) {
    if (child.namespaceURI === NS.wps && child.localName === "wsp") {
      const frame = synthFrameFromShape(child, ctx, nextId);
      if (frame) children.push(frame);
    } else if (child.namespaceURI === NS.pic && child.localName === "pic") {
      const frame = synthFrameFromPicture(child, ctx, nextId);
      if (frame) children.push(frame);
    } else if (child.namespaceURI === NS.wpg && child.localName === "grpSp") {
      // Nested group. Recursively flatten — represented as a child
      // group frame with its own coordinate system.
      const frame = synthFrameFromNestedGroup(child, ctx, nextId);
      if (frame) children.push(frame);
    }
  }

  return {
    kind: "group",
    children,
    childCoordSystemCx,
    childCoordSystemCy,
  };
}

function synthFrameFromShape(
  wsp: Element,
  ctx: AnchoredFramesContext,
  nextId: () => string,
): AnchoredFrame | null {
  const { off, ext } = readSpPrXfrm(wsp);
  if (!ext) return null;
  const content = parseShape(wsp, ctx);
  return {
    id: nextId(),
    anchor: { sectionIndex: 0, horizontalFrom: "page", verticalFrom: "page" },
    offsetXEmu: off?.x ?? 0,
    offsetYEmu: off?.y ?? 0,
    widthEmu: ext.cx,
    heightEmu: ext.cy,
    content,
  };
}

function synthFrameFromPicture(
  pic: Element,
  ctx: AnchoredFramesContext,
  nextId: () => string,
): AnchoredFrame | null {
  const { off, ext } = readSpPrXfrm(pic);
  const content = parsePicture(pic, ctx);
  if (!content) return null;
  if (!ext) return null;
  return {
    id: nextId(),
    anchor: { sectionIndex: 0, horizontalFrom: "page", verticalFrom: "page" },
    offsetXEmu: off?.x ?? 0,
    offsetYEmu: off?.y ?? 0,
    widthEmu: ext.cx,
    heightEmu: ext.cy,
    content,
  };
}

function synthFrameFromNestedGroup(
  grpSp: Element,
  ctx: AnchoredFramesContext,
  nextId: () => string,
): AnchoredFrame | null {
  const { off, ext } = readSpPrXfrm(grpSp);
  if (!ext) return null;
  // Treat the nested grpSp as a wpg-like body for the recursion.
  const content = parseGroup(grpSp, ctx, nextId);
  return {
    id: nextId(),
    anchor: { sectionIndex: 0, horizontalFrom: "page", verticalFrom: "page" },
    offsetXEmu: off?.x ?? 0,
    offsetYEmu: off?.y ?? 0,
    widthEmu: ext.cx,
    heightEmu: ext.cy,
    content,
  };
}

/**
 * Read a textbox's `<wps:bodyPr lIns/tIns/rIns/bIns>` internal insets
 * (EMU) into the `padding` the renderer applies. Returns `undefined`
 * unless at least one inset is declared — a bare `bodyPr` (no inset
 * attrs) keeps the no-padding behaviour. When some sides are declared
 * and others omitted, the omitted ones fall back to Word's factory
 * defaults (lIns/rIns = 91440 = 0.1in, tIns/bIns = 45720 = 0.05in) so a
 * partially-specified box still gets Word's geometry.
 */
function readBodyPrInsets(
  wsp: Element,
): { topEmu: number; rightEmu: number; bottomEmu: number; leftEmu: number } | undefined {
  const bodyPr = firstChildNS(wsp, NS.wps, "bodyPr");
  if (!bodyPr) return undefined;
  const read = (name: string): number | undefined => {
    const v = bodyPr.getAttribute(name);
    if (v === null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const l = read("lIns");
  const t = read("tIns");
  const r = read("rIns");
  const b = read("bIns");
  if (l === undefined && t === undefined && r === undefined && b === undefined) {
    return undefined;
  }
  const DEFAULT_LR = 91440;
  const DEFAULT_TB = 45720;
  return {
    leftEmu: l ?? DEFAULT_LR,
    topEmu: t ?? DEFAULT_TB,
    rightEmu: r ?? DEFAULT_LR,
    bottomEmu: b ?? DEFAULT_TB,
  };
}

function parseShape(wsp: Element, ctx: AnchoredFramesContext): AnchoredContent {
  // Textbox if there's `<wps:txbx><w:txbxContent>`. Otherwise a
  // geometric shape — `<wps:spPr><a:prstGeom prst="...">` carries
  // the shape kind.
  const txbx = firstChildNS(wsp, NS.wps, "txbx");
  if (txbx) {
    const txbxContent = firstChildNS(txbx, NS.w, "txbxContent");
    if (txbxContent) {
      const out: AnchoredContent = {
        kind: "textbox",
        body: parseTextboxBody(txbxContent, ctx),
      };
      const fill = readSolidFill(wsp);
      if (fill !== undefined) out.fill = fill;
      const border = readBorder(wsp);
      if (border !== undefined) out.border = border;
      // `<wps:bodyPr lIns/tIns/rIns/bIns>` are the textbox's internal
      // insets (EMU). They push the text in from the frame edge — Word
      // aligns jellap's contact box text to the body by combining the
      // column x-offset with lIns (≈2.5mm). Without reading them the text
      // hugs the frame's left edge and misaligns.
      const padding = readBodyPrInsets(wsp);
      if (padding !== undefined) out.padding = padding;
      return out;
    }
  }
  const out: AnchoredContent = {
    kind: "shape",
    geometry: readGeometry(wsp),
  };
  const fill = readSolidFill(wsp);
  if (fill !== undefined) out.fill = fill;
  const border = readBorder(wsp);
  if (border !== undefined) out.border = border;
  return out;
}

function parsePicture(pic: Element, ctx: AnchoredFramesContext): AnchoredContent | null {
  const blip = pic.getElementsByTagNameNS(NS.a, "blip")[0];
  if (!blip) return null;
  const rId =
    blip.getAttributeNS(NS.r, "embed") ?? blip.getAttribute("r:embed");
  if (!rId) return null;
  const target = ctx.rels.get(rId);
  if (!target) return null;
  const partPath = normalizePartPath(target);
  // <pic:nvPicPr><pic:cNvPr descr="..."/>
  const cNvPr = pic.getElementsByTagNameNS(NS.pic, "cNvPr")[0];
  const altText = cNvPr?.getAttribute("descr");
  const out: AnchoredContent = { kind: "picture", partPath };
  if (altText) out.altText = altText;
  return out;
}

/**
 * Parse a `<w:txbxContent>` into body blocks. Prefers the injected
 * full walker (`ctx.parseBlockBody`) so the content carries its real
 * run formatting, paragraph spacing, lists, and tables — essential
 * once a textbox flows into the body (`flowFrames`), and faithful for
 * overlays too. Falls back to flat text-only paragraphs when no walker
 * is injected (unit tests that exercise the parser in isolation).
 */
function parseTextboxBody(
  txbxContent: Element,
  ctx: AnchoredFramesContext,
): Block[] {
  if (ctx.parseBlockBody) return ctx.parseBlockBody(txbxContent);
  const out: Block[] = [];
  for (const child of Array.from(txbxContent.children)) {
    if (child.namespaceURI !== NS.w) continue;
    if (child.localName === "p") {
      const text = (child.textContent ?? "").trim();
      out.push({
        kind: "paragraph",
        runs: text ? [{ kind: "text", text, properties: {} }] : [],
        properties: {},
      });
    }
  }
  return out;
}

// === low-level OOXML readers ===

function readAnchorOrigin(
  anchor: Element,
  drawing: Element,
  ctx: AnchoredFramesContext,
): AnchorOrigin {
  const posH = firstChildNS(anchor, NS.wp, "positionH");
  const posV = firstChildNS(anchor, NS.wp, "positionV");
  const horizontalFrom = posH
    ? coerceHRelativeFrom(posH.getAttribute("relativeFrom"))
    : "page";
  const verticalFrom = posV
    ? coerceVRelativeFrom(posV.getAttribute("relativeFrom"))
    : "page";

  // Walk up from the drawing to its containing paragraph and look it
  // up in the caller's `bodyParagraphIndexByElement` map. When the
  // drawing isn't anchored to a body paragraph (e.g. it sits inside
  // a header/footer), the index stays undefined and the renderer
  // treats the frame as section-relative.
  let paragraphIndex: number | undefined;
  if (ctx.bodyParagraphIndexByElement) {
    let p: Element | null = drawing.parentElement;
    while (p && !(p.namespaceURI === NS.w && p.localName === "p")) {
      p = p.parentElement;
    }
    if (p) paragraphIndex = ctx.bodyParagraphIndexByElement.get(p);
  }

  const origin: AnchorOrigin = {
    sectionIndex: 0,
    horizontalFrom,
    verticalFrom,
  };
  if (paragraphIndex !== undefined) origin.paragraphIndex = paragraphIndex;
  return origin;
}

function readAnchorOffset(anchor: Element): { x: number; y: number } {
  const posH = firstChildNS(anchor, NS.wp, "positionH");
  const posV = firstChildNS(anchor, NS.wp, "positionV");
  return {
    x: readPosOffset(posH),
    y: readPosOffset(posV),
  };
}

function readPosOffset(positionEl: Element | null): number {
  if (!positionEl) return 0;
  const posOffset = firstChildNS(positionEl, NS.wp, "posOffset");
  if (!posOffset) return 0;
  const n = Number(posOffset.textContent ?? "0");
  return Number.isFinite(n) ? n : 0;
}

function readSpPrXfrm(shape: Element): {
  off?: { x: number; y: number };
  ext?: { cx: number; cy: number };
} {
  // Shape's own offset/extent live on `*:spPr > a:xfrm`. The wrapping
  // tag varies — wps:spPr for shapes, pic:spPr for pictures,
  // wpg:grpSpPr for nested groups — but the a:xfrm child is universal.
  const xfrms = Array.from(shape.getElementsByTagNameNS(NS.a, "xfrm"));
  // Pick the SHALLOWEST xfrm — the one that's a direct grandchild of
  // the shape, not one nested deeper (e.g. inside a pic's body).
  let best: Element | undefined;
  let bestDepth = Infinity;
  for (const x of xfrms) {
    let depth = 0;
    let cur: Element | null = x;
    while (cur && cur !== shape) {
      depth++;
      cur = cur.parentElement;
    }
    if (depth < bestDepth) {
      bestDepth = depth;
      best = x;
    }
  }
  if (!best) return {};
  const offEl = best.getElementsByTagNameNS(NS.a, "off")[0];
  const extEl = best.getElementsByTagNameNS(NS.a, "ext")[0];
  const out: { off?: { x: number; y: number }; ext?: { cx: number; cy: number } } = {};
  if (offEl) out.off = { x: numAttr(offEl, "x"), y: numAttr(offEl, "y") };
  if (extEl) out.ext = { cx: numAttr(extEl, "cx"), cy: numAttr(extEl, "cy") };
  return out;
}

function readGeometry(
  wsp: Element,
): "rect" | "ellipse" | "roundedRect" | "line" {
  const prstGeom = wsp.getElementsByTagNameNS(NS.a, "prstGeom")[0];
  const prst = prstGeom?.getAttribute("prst");
  switch (prst) {
    case "ellipse":
      return "ellipse";
    case "roundRect":
      return "roundedRect";
    case "line":
    case "straightConnector1":
      return "line";
    case "rect":
    default:
      return "rect";
  }
}

function readSolidFill(shape: Element): string | undefined {
  // First `<a:solidFill><a:srgbClr val="RRGGBB"/></a:solidFill>` inside
  // the shape's spPr. Theme colours / scheme references intentionally
  // unsupported — fall through to undefined (renderer treats as no fill).
  const spPr =
    firstChildNS(shape, NS.wps, "spPr") ??
    firstChildNS(shape, NS.pic, "spPr");
  if (!spPr) return undefined;
  // Use direct descendant traversal so we don't pick up a fill nested
  // deeper inside a child shape.
  for (const fill of Array.from(spPr.children)) {
    if (fill.namespaceURI === NS.a && fill.localName === "solidFill") {
      const srgb = firstChildNS(fill, NS.a, "srgbClr");
      const val = srgb?.getAttribute("val");
      if (val && /^[0-9A-Fa-f]{6}$/.test(val)) return `#${val.toUpperCase()}`;
    }
  }
  return undefined;
}

function readBorder(shape: Element):
  | { color: string; widthEmu: number; style: "solid" | "dashed" | "dotted" | "double" }
  | undefined {
  const spPr =
    firstChildNS(shape, NS.wps, "spPr") ??
    firstChildNS(shape, NS.pic, "spPr");
  if (!spPr) return undefined;
  const ln = firstChildNS(spPr, NS.a, "ln");
  if (!ln) return undefined;
  const widthEmu = numAttr(ln, "w");
  const solidFill = firstChildNS(ln, NS.a, "solidFill");
  const srgb = solidFill ? firstChildNS(solidFill, NS.a, "srgbClr") : null;
  const val = srgb?.getAttribute("val");
  if (!val || !/^[0-9A-Fa-f]{6}$/.test(val)) return undefined;
  const prstDash = firstChildNS(ln, NS.a, "prstDash");
  const style = coerceBorderStyle(prstDash?.getAttribute("val"));
  return { color: `#${val.toUpperCase()}`, widthEmu: widthEmu || 0, style };
}

function coerceBorderStyle(
  v: string | null | undefined,
): "solid" | "dashed" | "dotted" | "double" {
  switch (v) {
    case "dash":
    case "lgDash":
    case "sysDash":
      return "dashed";
    case "dot":
    case "sysDot":
      return "dotted";
    default:
      return "solid";
  }
}

function coerceHRelativeFrom(v: string | null): "page" | "margin" | "column" {
  switch (v) {
    case "page":
    case "margin":
    case "column":
      return v;
    default:
      return "page";
  }
}

function coerceVRelativeFrom(v: string | null): "page" | "margin" | "paragraph" {
  switch (v) {
    case "page":
    case "margin":
    case "paragraph":
      return v;
    default:
      return "page";
  }
}

function numAttr(el: Element, name: string): number {
  const n = Number(el.getAttribute(name) ?? "0");
  return Number.isFinite(n) ? n : 0;
}

function firstChildNS(parent: Element, ns: string, local: string): Element | null {
  for (const child of Array.from(parent.children)) {
    if (child.namespaceURI === ns && child.localName === local) return child;
  }
  return null;
}

function normalizePartPath(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  if (target.startsWith("word/")) return target;
  return `word/${target}`;
}
