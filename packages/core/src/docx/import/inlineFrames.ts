/**
 * Parse `<w:drawing><wp:inline>` payloads carrying a textbox into a
 * list of `InlineFrame` blocks — one frame per top-level inline
 * drawing in the document.
 *
 * See `packages/core/docs/INLINE_FRAME_DESIGN.md` for the design.
 *
 * **Phase 1.1 status**: this parser is pure and complete; it returns
 * `{ frame, drawingEl, hostParagraphEl }` tuples so the import
 * pipeline can both insert frames into the body AND mark their
 * source drawings so the legacy `liftTextBoxContent` skips them.
 * Phase 1.2 wires the renderer; Phase 1.4 deletes the lifter.
 *
 * What we DO parse:
 *   - `<w:drawing><wp:inline>` containing `<wpg:wgp>` with at least
 *     one `<wps:wsp><wps:txbx>` — section headings, "Project: X"
 *     frames, every textbox-bearing inline drawing.
 *   - The CONTAINING `<w:p>`'s `<w:pPr>` page-break-before /
 *     keep-next directives — they semantically belong to the frame,
 *     not the inner content.
 *   - Sibling `<pic:pic>` decorations inside the group.
 *   - Sibling `<wps:wsp>` shapes (rect / ellipse / line) WITHOUT a
 *     textbox payload — pure decoration.
 *   - Each textbox's intra-group offset+size from its `<wps:spPr>`
 *     `<a:xfrm>`.
 *
 * What we do NOT parse:
 *   - `<wp:anchor>` drawings (absolute-positioned) — `anchoredFrames.ts`
 *     handles those.
 *   - Inline drawings with ONLY a picture (no group, no textbox) —
 *     those stay as `DrawingRun` in the paragraph's inline runs.
 *   - `<w:pict>` VML legacy fallback.
 *
 * Recursive body parsing is delegated to a caller-supplied
 * `parseBlockBody(txbxContent)` so this module doesn't depend on
 * the body-paragraph walker (which lives in `paragraph.ts`).
 */

import type { Block, FrameBorder, InlineFrame } from "../../doc/types";
import { NS } from "../shared/namespaces";

export interface InlineFramesContext {
  /** RelationshipId → part path lookup. */
  rels: Map<string, string>;
  /**
   * Recursive body parser supplied by the caller. The textbox content
   * (`<w:txbxContent>`) is a body of `<w:p>` / `<w:tbl>` children
   * that should parse with the same rules as the document body —
   * paragraph properties, runs, tables, even nested inline frames.
   * Phase 1.1: callers can pass a simple text-only stub; Phase 1.2+
   * will pass the full body walker.
   */
  parseBlockBody: (txbxContent: Element) => Block[];
  /**
   * When true, `<w:lastRenderedPageBreak/>` HINTS inside the textbox
   * content cascade up to set `InlineFrame.pageBreakBefore`. These
   * are stale layout hints Word writes during save, not author-
   * declared directives — ECMA-376 says consumers SHOULD ignore
   * them for layout. We respect them in two cases:
   *   1. The body walker already opted in (heavily-decorated CVs
   *      where the hints reliably match LO's reference pagination —
   *      threshold is `≥10` total LRPB elements in the doc, decided
   *      by `convertDocumentXml` and threaded through here).
   *   2. The frame contains an explicit `<w:pageBreakBefore/>` in
   *      the outer paragraph's pPr (always honoured).
   * Without this flag, only explicit directives count.
   */
  honorLastRenderedPageBreaks?: boolean;
}

/**
 * One InlineFrame plus the source DOM nodes it came from.
 *
 * `drawingEl` is the `<w:drawing>` the importer should TREAT AS
 * REMOVED (legacy lifter will skip it; renderer paints from `frame`).
 *
 * `hostParagraphEl` is the `<w:p>` that contained the drawing — its
 * outer `<w:pPr>` props (pageBreakBefore, keepNext) flowed into the
 * frame. After the new path takes over, this paragraph becomes
 * empty in the source; the importer can treat the InlineFrame as
 * REPLACING it in the body block stream.
 */
export interface ParsedInlineFrame {
  frame: InlineFrame;
  drawingEl: Element;
  hostParagraphEl: Element;
}

/**
 * Walk every `<w:drawing>/<wp:inline>` in the document. For drawings
 * whose payload includes at least one `<wps:txbx>`, emit one
 * `InlineFrame`. Returns the frames in document order.
 *
 * When `claim` is true (the default), each claimed `<w:drawing>` is
 * REMOVED from the input XML so the legacy `liftTextBoxContent` pass
 * downstream can't double-process it. The host paragraph stays in
 * place (now empty) so the body walker still emits a paragraph
 * block at the right position — which the importer then swaps for
 * the corresponding `InlineFrame` via `ConvertOptions.replaceParagraphs`.
 *
 * Set `claim: false` to inspect frames without mutating the XML
 * (used by unit tests).
 */
export function parseInlineFrames(
  xmlDoc: Document,
  ctx: InlineFramesContext,
  claim = true,
): ParsedInlineFrame[] {
  const out: ParsedInlineFrame[] = [];
  const drawings = Array.from(xmlDoc.getElementsByTagNameNS(NS.w, "drawing"));
  let counter = 0;
  for (const drawing of drawings) {
    const inline = firstChildNS(drawing, NS.wp, "inline");
    if (!inline) continue; // Anchored drawings handled by anchoredFrames.ts

    const graphicData = firstNS(inline, NS.a, "graphicData");
    if (!graphicData) continue;
    const wpg = firstChildNS(graphicData, NS.wpg, "wgp");
    if (!wpg) continue; // No group → handled as plain DrawingRun inline.

    // The wgp must contain at least one textbox shape for this
    // parser to claim the drawing. Pure-picture or pure-shape
    // groups (no <wps:txbx>) stay with the legacy DrawingRun path
    // until a later phase migrates those too.
    const wsps = directChildrenNS(wpg, NS.wps, "wsp");
    const hasTextbox = wsps.some((w) => firstChildNS(w, NS.wps, "txbx") !== null);
    if (!hasTextbox) continue;

    const hostP = findAncestor(drawing, NS.w, "p");
    if (!hostP) continue;

    const frame = buildInlineFrame(wpg, hostP, ctx, () => `inline-${counter++}`);
    if (!frame) continue;
    out.push({ frame, drawingEl: drawing, hostParagraphEl: hostP });
  }

  // Claim pass: remove each successfully-parsed drawing AFTER the
  // whole walk so we don't disturb live DOM iteration. The host
  // paragraph stays (often becomes empty); the body walker emits
  // a Paragraph block at its position; the importer's
  // `replaceParagraphs` map then swaps that block for the InlineFrame.
  if (claim) {
    for (const { drawingEl } of out) {
      drawingEl.parentNode?.removeChild(drawingEl);
    }
  }

  return out;
}

// === implementation ===

function buildInlineFrame(
  wpg: Element,
  hostP: Element,
  ctx: InlineFramesContext,
  _nextId: () => string,
): InlineFrame | null {
  // Group's intrinsic coordinate-system extent (where children's
  // offsets live). `<wpg:grpSpPr><a:xfrm><a:chExt>` is the
  // canonical place; `<a:ext>` on the same xfrm is the group's
  // RENDERED size — usually the same as chExt for inline drawings
  // but kept separate per the OOXML model.
  const grpSpPr = firstChildNS(wpg, NS.wpg, "grpSpPr");
  const groupXfrm = grpSpPr
    ? firstNS(grpSpPr, NS.a, "xfrm")
    : undefined;
  const chExt = groupXfrm ? firstNS(groupXfrm, NS.a, "chExt") : undefined;
  const ext = groupXfrm ? firstNS(groupXfrm, NS.a, "ext") : undefined;
  const groupExtentEmu = chExt
    ? { wEmu: numAttr(chExt, "cx"), hEmu: numAttr(chExt, "cy") }
    : { wEmu: numAttr(ext, "cx"), hEmu: numAttr(ext, "cy") };
  const sizeEmu = ext
    ? { wEmu: numAttr(ext, "cx"), hEmu: numAttr(ext, "cy") }
    : groupExtentEmu;
  if (groupExtentEmu.wEmu <= 0 || groupExtentEmu.hEmu <= 0) return null;

  // Read break / keep-next directives from the CONTAINING paragraph's
  // pPr. The directive semantically belongs to the frame block, not
  // to the inner content paragraph.
  const pPr = firstChildNS(hostP, NS.w, "pPr");
  let pageBreakBefore = pPr
    ? firstChildNS(pPr, NS.w, "pageBreakBefore") !== null
    : false;
  const keepNext = pPr ? firstChildNS(pPr, NS.w, "keepNext") !== null : false;

  // When the caller opted into LRPB-as-directive, a `<w:lastRenderedPageBreak/>`
  // hint inside the OUTER paragraph escalates to `pageBreakBefore: true`
  // on the frame. (LRPB hints typically live OUTSIDE the drawing — in
  // sibling `<w:r>` elements of the outer paragraph — exactly where
  // `convertParagraph` finds them for plain body paragraphs.) Skipping
  // `<w:txbxContent>` matches the body walker's behaviour so a hint
  // inside the textbox text doesn't cascade up.
  if (!pageBreakBefore && ctx.honorLastRenderedPageBreaks) {
    if (hasLastRenderedPageBreakSkippingTxbx(hostP)) pageBreakBefore = true;
  }

  // Walk group children: each <wps:wsp> is either a textbox or a
  // shape decoration; each <pic:pic> is a picture decoration.
  let textbox: InlineFrame["textbox"];
  const pictures: Array<InlineFrame["pictures"][number]> = [];
  const shapes: Array<InlineFrame["shapes"][number]> = [];

  for (const child of Array.from(wpg.children)) {
    if (child.namespaceURI === NS.wps && child.localName === "wsp") {
      const txbx = firstChildNS(child, NS.wps, "txbx");
      if (txbx) {
        // Textbox-bearing shape → contributes the frame's body.
        // We honour only the FIRST textbox in a group for now; multi-
        // textbox groups are rare in the corpus and need their own
        // model (each becomes its own frame? or the group becomes
        // a "group of frames"?). Defer to a follow-up.
        if (textbox) continue;
        const txbxContent = firstChildNS(txbx, NS.w, "txbxContent");
        if (!txbxContent) continue;
        const { off, ext: shapeExt } = readShapeXfrm(child);
        textbox = {
          offsetEmu: { xEmu: off.x, yEmu: off.y },
          sizeEmu: { wEmu: shapeExt.cx, hEmu: shapeExt.cy },
          body: ctx.parseBlockBody(txbxContent),
        };
        const fill = readSolidFill(child);
        if (fill !== undefined) textbox.fill = fill;
        const border = readBorder(child);
        if (border !== undefined) textbox.border = border;
        // `<wps:bodyPr>` carries the text insets + vertical anchor. Word
        // centers a single heading line by top-anchoring it inside a
        // short textbox whose insets + centered placement land the line
        // at the pill's middle; dropping the insets floats it too high.
        const bodyPr = firstChildNS(child, NS.wps, "bodyPr");
        if (bodyPr) {
          textbox.padding = {
            leftEmu: numAttrOr(bodyPr, "lIns", 91440),
            topEmu: numAttrOr(bodyPr, "tIns", 45720),
            rightEmu: numAttrOr(bodyPr, "rIns", 91440),
            bottomEmu: numAttrOr(bodyPr, "bIns", 45720),
          };
          const anchor = bodyPr.getAttribute("anchor");
          if (anchor === "ctr") textbox.vAlign = "center";
          else if (anchor === "b") textbox.vAlign = "bottom";
          else textbox.vAlign = "top";
        }
      } else {
        // Shape-without-textbox → decoration.
        const { off, ext: shapeExt } = readShapeXfrm(child);
        if (shapeExt.cx <= 0 || shapeExt.cy <= 0) continue;
        const geom = readGeometry(child);
        const fill = readSolidFill(child);
        const border = readBorder(child);
        const decoration: InlineFrame["shapes"][number] = {
          geometry: geom,
          offsetEmu: { xEmu: off.x, yEmu: off.y },
          sizeEmu: { wEmu: shapeExt.cx, hEmu: shapeExt.cy },
        };
        if (fill !== undefined) decoration.fill = fill;
        if (border !== undefined) decoration.border = border;
        shapes.push(decoration);
      }
    } else if (child.namespaceURI === NS.pic && child.localName === "pic") {
      const blip = child.getElementsByTagNameNS(NS.a, "blip")[0];
      if (!blip) continue;
      const rId =
        blip.getAttributeNS(NS.r, "embed") ?? blip.getAttribute("r:embed");
      if (!rId) continue;
      const target = ctx.rels.get(rId);
      if (!target) continue;
      const partPath = normalizePartPath(target);
      const { off, ext: picExt } = readShapeXfrm(child);
      if (picExt.cx <= 0 || picExt.cy <= 0) continue;
      const cNvPr = child.getElementsByTagNameNS(NS.pic, "cNvPr")[0];
      const altText = cNvPr?.getAttribute("descr");
      const picture: InlineFrame["pictures"][number] = {
        partPath,
        offsetEmu: { xEmu: off.x, yEmu: off.y },
        sizeEmu: { wEmu: picExt.cx, hEmu: picExt.cy },
      };
      if (altText) picture.altText = altText;
      pictures.push(picture);
    }
  }

  const out: InlineFrame = {
    kind: "inline_frame",
    groupExtentEmu,
    sizeEmu,
    pictures,
    shapes,
  };
  if (pageBreakBefore) out.pageBreakBefore = true;
  if (keepNext) out.keepNext = true;
  if (textbox) out.textbox = textbox;
  return out;
}

// === low-level OOXML readers ===

function readShapeXfrm(shape: Element): {
  off: { x: number; y: number };
  ext: { cx: number; cy: number };
} {
  // Shape's own offset/extent live on `*:spPr > a:xfrm`. wps:spPr for
  // shapes, pic:spPr for pictures.
  const spPr =
    firstChildNS(shape, NS.wps, "spPr") ?? firstChildNS(shape, NS.pic, "spPr");
  if (!spPr) return { off: { x: 0, y: 0 }, ext: { cx: 0, cy: 0 } };
  const xfrm = firstNS(spPr, NS.a, "xfrm");
  if (!xfrm) return { off: { x: 0, y: 0 }, ext: { cx: 0, cy: 0 } };
  const offEl = firstNS(xfrm, NS.a, "off");
  const extEl = firstNS(xfrm, NS.a, "ext");
  return {
    off: offEl ? { x: numAttr(offEl, "x"), y: numAttr(offEl, "y") } : { x: 0, y: 0 },
    ext: extEl ? { cx: numAttr(extEl, "cx"), cy: numAttr(extEl, "cy") } : { cx: 0, cy: 0 },
  };
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
  const spPr =
    firstChildNS(shape, NS.wps, "spPr") ?? firstChildNS(shape, NS.pic, "spPr");
  if (!spPr) return undefined;
  for (const fill of Array.from(spPr.children)) {
    if (fill.namespaceURI === NS.a && fill.localName === "solidFill") {
      const srgb = firstChildNS(fill, NS.a, "srgbClr");
      const val = srgb?.getAttribute("val");
      if (val && /^[0-9A-Fa-f]{6}$/.test(val)) return `#${val.toUpperCase()}`;
    }
  }
  return undefined;
}

function readBorder(shape: Element): FrameBorder | undefined {
  const spPr =
    firstChildNS(shape, NS.wps, "spPr") ?? firstChildNS(shape, NS.pic, "spPr");
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

function hasLastRenderedPageBreakSkippingTxbx(root: Element): boolean {
  // Walk descendants of `root`, returning true if any is a
  // `<w:lastRenderedPageBreak/>`. Skips into `<w:txbxContent>` are
  // suppressed — a hint nested INSIDE the textbox content is the
  // textbox's own internal pagination concern, not the host
  // paragraph's. Mirrors `hasLastRenderedPageBreak` in `paragraph.ts`.
  const stack: Element[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    for (const child of Array.from(el.children)) {
      if (child.localName === "txbxContent") continue;
      if (
        child.localName === "lastRenderedPageBreak" &&
        child.namespaceURI === NS.w
      ) {
        return true;
      }
      stack.push(child);
    }
  }
  return false;
}

function numAttr(el: Element | undefined | null, name: string): number {
  if (!el) return 0;
  const n = Number(el.getAttribute(name) ?? "0");
  return Number.isFinite(n) ? n : 0;
}

/** Read a numeric attribute, falling back to `fallback` when absent —
 *  used for `<wps:bodyPr>` insets whose OOXML defaults are non-zero. */
function numAttrOr(el: Element, name: string, fallback: number): number {
  const raw = el.getAttribute(name);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function firstChildNS(parent: Element, ns: string, local: string): Element | null {
  for (const child of Array.from(parent.children)) {
    if (child.namespaceURI === ns && child.localName === local) return child;
  }
  return null;
}

function firstNS(root: Element, ns: string, local: string): Element | null {
  const found = root.getElementsByTagNameNS(ns, local)[0];
  return found ?? null;
}

function directChildrenNS(parent: Element, ns: string, local: string): Element[] {
  const out: Element[] = [];
  for (const child of Array.from(parent.children)) {
    if (child.namespaceURI === ns && child.localName === local) out.push(child);
  }
  return out;
}

function findAncestor(start: Element, ns: string, local: string): Element | null {
  let el: Element | null = start.parentElement;
  while (el) {
    if (el.namespaceURI === ns && el.localName === local) return el;
    el = el.parentElement;
  }
  return null;
}

function normalizePartPath(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  if (target.startsWith("word/")) return target;
  return `word/${target}`;
}
