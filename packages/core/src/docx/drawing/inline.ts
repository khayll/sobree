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
 *   - `<wp:anchor>` drawings (absolute-positioned) — `anchored.ts`
 *     handles those.
 *   - Inline drawings with ONLY a picture (no group, no textbox) —
 *     those stay as `DrawingRun` in the paragraph's inline runs.
 *   - `<w:pict>` VML legacy fallback.
 *
 * Recursive body parsing is delegated to a caller-supplied
 * `parseBlockBody(txbxContent)` so this module doesn't depend on
 * the body-paragraph walker (which lives in `paragraph.ts`).
 */

import type { Block, InlineFrame, InlineFrameTextbox } from "../../doc/types";
import { NS } from "../shared/namespaces";
import type { ThemePalette } from "./colors";
import { directChildrenNS, findAncestor, firstChildNS, firstNS } from "./dom";
import { numAttr, numAttrOr } from "./extents";
import { readBlipEmbedPart } from "./relationships";
import { readBorder, readGeometry, readSolidFill } from "./shapeProps";

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
  /** Theme colour palette (from `word/theme/theme1.xml`) so textbox /
   *  shape fills declared as `<a:schemeClr>` resolve instead of vanishing. */
  theme?: ThemePalette;
  /**
   * Body content width in EMU (page width − left/right margins). Needed
   * only to lay out a paragraph that holds MORE THAN ONE inline drawing
   * (a tab-separated row of "Place Illustration here" boxes): the boxes
   * are merged into one frame whose coordinate system IS the content
   * column, so each box's x is a true fraction of the column. Absent ⇒
   * single-drawing paragraphs only, no row layout.
   */
  contentWidthEmu?: number;
  /** `<w:defaultTabStop>` in twips — the grid a `<w:tab>` advances to when
   *  the paragraph declares no explicit `<w:tabs>`. Drives the column
   *  positions of a multi-drawing row. Absent ⇒ Word's 720-twip default. */
  defaultTabStopTwips?: number;
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
  const inlineCountByParagraph = countInlineDrawingsByParagraph(drawings);
  let counter = 0;
  for (const drawing of drawings) {
    const inline = firstChildNS(drawing, NS.wp, "inline");
    if (!inline) continue; // Anchored drawings handled by anchored.ts

    const graphicData = firstNS(inline, NS.a, "graphicData");
    if (!graphicData) continue;

    const hostP = findAncestor(drawing, NS.w, "p");
    if (!hostP) continue;

    const wpg = firstChildNS(graphicData, NS.wpg, "wgp");
    if (wpg) {
      // The wgp must contain at least one textbox shape for this
      // parser to claim the drawing. Pure-picture or pure-shape
      // groups (no <wps:txbx>) stay with the legacy DrawingRun path
      // until a later phase migrates those too.
      const wsps = directChildrenNS(wpg, NS.wps, "wsp");
      const hasTextbox = wsps.some((w) => firstChildNS(w, NS.wps, "txbx") !== null);
      if (!hasTextbox) continue;

      const frame = buildInlineFrame(wpg, hostP, ctx, () => `inline-${counter++}`);
      if (!frame) continue;
      out.push({ frame, drawingEl: drawing, hostParagraphEl: hostP });
      continue;
    }

    // No group: a BARE `<wps:wsp>` directly under graphicData.
    const bareWsp = firstChildNS(graphicData, NS.wps, "wsp");
    if (!bareWsp) continue;
    if (firstChildNS(bareWsp, NS.wps, "txbx") !== null) {
      // A bare inline TEXTBOX. A lone one (its own paragraph) flows fine
      // through the legacy lifter as a body paragraph — claiming it would
      // pin it to a fixed-height box and clip long instructional text, so
      // leave it. Only claim when the paragraph holds a ROW of them
      // (multiple inline drawings, tab-separated "Place Illustration here"
      // boxes) — the case the lifter drops; `mergeRowsByHostParagraph`
      // lays them across the column.
      if ((inlineCountByParagraph.get(hostP) ?? 0) < 2) continue;
      const frame = buildBareTextboxFrame(inline, bareWsp, hostP, ctx);
      if (frame) {
        out.push({ frame, drawingEl: drawing, hostParagraphEl: hostP });
        counter++;
      }
    } else {
      // A pure decoration rectangle (a photo-placeholder square). Claim it —
      // the legacy DrawingRun reader needs an image blip and drops it.
      const frame = buildBareShapeFrame(inline, bareWsp, hostP, ctx);
      if (frame) {
        out.push({ frame, drawingEl: drawing, hostParagraphEl: hostP });
        counter++;
      }
    }
  }

  // Collapse multiple inline drawings that share ONE host paragraph into
  // a single row frame (e.g. three tab-separated "Place Illustration here"
  // boxes). Must run BEFORE the claim pass — the row layout reads the
  // paragraph's `<w:tab>` runs, which are still interleaved with the (not
  // yet removed) drawings. One-drawing paragraphs pass through untouched.
  const merged = mergeRowsByHostParagraph(out, ctx);

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

  return merged;
}

/** Count inline drawings per host paragraph (nearest `<w:p>` ancestor).
 *  A drawing nested inside a textbox maps to its OWN inner paragraph, not
 *  the outer host — so a single box whose content holds an image still
 *  counts as one. Drives the "is this a row?" test for bare textboxes. */
function countInlineDrawingsByParagraph(drawings: Element[]): Map<Element, number> {
  const counts = new Map<Element, number>();
  for (const drawing of drawings) {
    if (!firstChildNS(drawing, NS.wp, "inline")) continue;
    const p = findAncestor(drawing, NS.w, "p");
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return counts;
}

const EMU_PER_TWIP = 635; // 914400 EMU/inch ÷ 1440 twips/inch

/**
 * Merge inline frames that share a host paragraph into one row frame.
 *
 * Word lays a row of inline drawings out with the paragraph's tab stops:
 * `[box] <tab> [box] <tab> [box]`. Each box is its own `<wp:inline>`
 * drawing, so the per-drawing pass produced one frame each — but they all
 * map to the SAME host paragraph and the block model allows only one frame
 * there. We walk the paragraph's runs in document order, advancing an EMU
 * cursor by each box's width and snapping it to the next tab stop on each
 * `<w:tab>`, then stack every box into ONE frame whose coordinate system is
 * the content column. Groups of one frame are returned unchanged.
 */
function mergeRowsByHostParagraph(
  parsed: ParsedInlineFrame[],
  ctx: InlineFramesContext,
): ParsedInlineFrame[] {
  const byHost = new Map<Element, ParsedInlineFrame[]>();
  for (const p of parsed) {
    const list = byHost.get(p.hostParagraphEl);
    if (list) list.push(p);
    else byHost.set(p.hostParagraphEl, [p]);
  }
  const out: ParsedInlineFrame[] = [];
  for (const [hostP, group] of byHost) {
    if (group.length === 1) {
      out.push(group[0]!);
      continue;
    }
    out.push({
      frame: composeRowFrame(hostP, group, ctx),
      // Any of the group's drawings serves as the claim/host anchor; the
      // importer keys the replacement on the paragraph, and the claim pass
      // removes every drawing element regardless.
      drawingEl: group[0]!.drawingEl,
      hostParagraphEl: hostP,
    });
  }
  return out;
}

/** Lay a group of single-drawing frames across the content column at the
 *  paragraph's tab positions, returning one combined row frame. */
function composeRowFrame(
  hostP: Element,
  group: ParsedInlineFrame[],
  ctx: InlineFramesContext,
): InlineFrame {
  const columnEmu = ctx.contentWidthEmu && ctx.contentWidthEmu > 0 ? ctx.contentWidthEmu : null;
  const tabStopsEmu = readCustomTabStopsEmu(hostP);
  const defaultTabEmu = (ctx.defaultTabStopTwips ?? 720) * EMU_PER_TWIP;

  const textboxes: InlineFrameTextbox[] = [];
  const shapes: Array<InlineFrame["shapes"][number]> = [];
  const pictures: Array<InlineFrame["pictures"][number]> = [];
  let cursorEmu = 0;
  let rowHeightEmu = 0;
  let next = 0; // index into `group`, consumed in run order

  for (const run of directChildrenNS(hostP, NS.w, "r")) {
    if (run.getElementsByTagNameNS(NS.w, "drawing").length > 0 && next < group.length) {
      const f = group[next++]!.frame;
      shiftFrameInto(f, cursorEmu, { textboxes, shapes, pictures });
      cursorEmu += f.sizeEmu.wEmu;
      rowHeightEmu = Math.max(rowHeightEmu, f.sizeEmu.hEmu);
    } else if (firstChildNS(run, NS.w, "tab") !== null) {
      cursorEmu = nextTabStopEmu(cursorEmu, tabStopsEmu, defaultTabEmu);
    }
  }

  // The frame's coordinate system spans the content column so each box's
  // offset/width reads as a true fraction of it. Without a known column
  // width, fall back to the consumed row width (boxes still ordered, but
  // the row stretches to the full body width on render).
  const widthEmu = columnEmu ?? Math.max(cursorEmu, 1);
  return {
    kind: "inline_frame",
    groupExtentEmu: { wEmu: widthEmu, hEmu: rowHeightEmu },
    sizeEmu: { wEmu: widthEmu, hEmu: rowHeightEmu },
    textboxes,
    pictures,
    shapes,
  };
}

/** Copy a single-drawing frame's regions into the row accumulators,
 *  translated right by `dxEmu` (its column position). */
function shiftFrameInto(
  f: InlineFrame,
  dxEmu: number,
  acc: {
    textboxes: InlineFrameTextbox[];
    shapes: Array<InlineFrame["shapes"][number]>;
    pictures: Array<InlineFrame["pictures"][number]>;
  },
): void {
  for (const tb of f.textboxes) {
    acc.textboxes.push({
      ...tb,
      offsetEmu: { xEmu: tb.offsetEmu.xEmu + dxEmu, yEmu: tb.offsetEmu.yEmu },
    });
  }
  for (const s of f.shapes) {
    acc.shapes.push({
      ...s,
      offsetEmu: { xEmu: s.offsetEmu.xEmu + dxEmu, yEmu: s.offsetEmu.yEmu },
    });
  }
  for (const p of f.pictures) {
    acc.pictures.push({
      ...p,
      offsetEmu: { xEmu: p.offsetEmu.xEmu + dxEmu, yEmu: p.offsetEmu.yEmu },
    });
  }
}

/** Read explicit `<w:pPr><w:tabs><w:tab w:pos>` stops, ascending EMU. */
function readCustomTabStopsEmu(hostP: Element): number[] {
  const pPr = firstChildNS(hostP, NS.w, "pPr");
  const tabs = pPr ? firstChildNS(pPr, NS.w, "tabs") : null;
  if (!tabs) return [];
  const out: number[] = [];
  for (const tab of directChildrenNS(tabs, NS.w, "tab")) {
    const pos = tab.getAttributeNS(NS.w, "pos") ?? tab.getAttribute("w:pos");
    const n = pos ? Number(pos) : Number.NaN;
    if (Number.isFinite(n)) out.push(n * EMU_PER_TWIP);
  }
  return out.sort((a, b) => a - b);
}

/** First tab stop strictly past `xEmu` — an explicit stop if one lies
 *  ahead, else the next cell on the default grid. */
function nextTabStopEmu(xEmu: number, customEmu: number[], defaultEmu: number): number {
  for (const stop of customEmu) if (stop > xEmu + 1) return stop;
  if (defaultEmu <= 0) return xEmu;
  return (Math.floor(xEmu / defaultEmu) + 1) * defaultEmu;
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
  const groupXfrm = grpSpPr ? firstNS(grpSpPr, NS.a, "xfrm") : undefined;
  const chExt = groupXfrm ? firstNS(groupXfrm, NS.a, "chExt") : undefined;
  const ext = groupXfrm ? firstNS(groupXfrm, NS.a, "ext") : undefined;
  const groupExtentEmu = chExt
    ? { wEmu: numAttr(chExt, "cx"), hEmu: numAttr(chExt, "cy") }
    : { wEmu: numAttr(ext, "cx"), hEmu: numAttr(ext, "cy") };
  const sizeEmu = ext ? { wEmu: numAttr(ext, "cx"), hEmu: numAttr(ext, "cy") } : groupExtentEmu;
  if (groupExtentEmu.wEmu <= 0 || groupExtentEmu.hEmu <= 0) return null;

  // Read break / keep-next directives from the CONTAINING paragraph's
  // pPr. The directive semantically belongs to the frame block, not
  // to the inner content paragraph.
  const pPr = firstChildNS(hostP, NS.w, "pPr");
  let pageBreakBefore = pPr ? firstChildNS(pPr, NS.w, "pageBreakBefore") !== null : false;
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

  // Walk group children (recursively): each <wps:wsp> is a textbox or a
  // shape decoration, each <pic:pic> a picture, and a <wpg:grpSp> is a
  // NESTED group we descend into. Word nests the title textbox + arrow of
  // a "Project: X" entry inside a grpSp while the details textbox sits at
  // the top level — both must be collected, in document order.
  const textboxes: InlineFrameTextbox[] = [];
  const pictures: Array<InlineFrame["pictures"][number]> = [];
  const shapes: Array<InlineFrame["shapes"][number]> = [];

  const collectFromGroup = (group: Element): void => {
    for (const child of Array.from(group.children)) {
      if (child.namespaceURI === NS.wpg && child.localName === "grpSp") {
        collectFromGroup(child);
      } else if (child.namespaceURI === NS.wps && child.localName === "wsp") {
        const txbx = firstChildNS(child, NS.wps, "txbx");
        if (txbx) {
          // Textbox-bearing shape → contributes a body region. A group can
          // hold several (a "Project: X" entry has a title textbox AND a
          // details textbox); capture ALL of them in document order so the
          // renderer can show every one.
          const textbox = readInlineTextbox(child, ctx);
          if (textbox) textboxes.push(textbox);
        } else {
          // Shape-without-textbox → decoration.
          const { off, ext: shapeExt } = readShapeXfrm(child);
          if (shapeExt.cx <= 0 || shapeExt.cy <= 0) continue;
          const geom = readGeometry(child);
          const fill = readSolidFill(child, ctx.theme);
          const border = readBorder(child, ctx.theme);
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
        const partPath = readBlipEmbedPart(blip, ctx.rels);
        if (!partPath) continue;
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
  };
  collectFromGroup(wpg);

  const out: InlineFrame = {
    kind: "inline_frame",
    groupExtentEmu,
    sizeEmu,
    textboxes,
    pictures,
    shapes,
  };
  if (pageBreakBefore) out.pageBreakBefore = true;
  if (keepNext) out.keepNext = true;
  return out;
}

/**
 * Read a `<wps:wsp>` carrying a `<wps:txbx>` into an `InlineFrameTextbox`
 * — body content, fill, border, and the `<wps:bodyPr>` insets + vertical
 * anchor. Shared by the grouped path (a "Project: X" entry) and the bare
 * path (a standalone "Place Illustration here" box). Returns `null` when
 * the shape has no resolvable textbox content.
 */
function readInlineTextbox(wsp: Element, ctx: InlineFramesContext): InlineFrameTextbox | null {
  const txbx = firstChildNS(wsp, NS.wps, "txbx");
  const txbxContent = txbx ? firstChildNS(txbx, NS.w, "txbxContent") : null;
  if (!txbxContent) return null;
  const { off, ext: shapeExt } = readShapeXfrm(wsp);
  const textbox: InlineFrameTextbox = {
    offsetEmu: { xEmu: off.x, yEmu: off.y },
    sizeEmu: { wEmu: shapeExt.cx, hEmu: shapeExt.cy },
    body: ctx.parseBlockBody(txbxContent),
  };
  const fill = readSolidFill(wsp, ctx.theme);
  if (fill !== undefined) textbox.fill = fill;
  const border = readBorder(wsp, ctx.theme);
  if (border !== undefined) textbox.border = border;
  // `<wps:bodyPr>` carries the text insets + vertical anchor. Word
  // centers a single heading line by top-anchoring it inside a short
  // textbox whose insets + centered placement land the line at the pill's
  // middle; dropping the insets floats it too high.
  const bodyPr = firstChildNS(wsp, NS.wps, "bodyPr");
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
  return textbox;
}

/**
 * Build an `InlineFrame` for a BARE `<wps:wsp>` TEXTBOX (no `<wpg:wgp>`
 * group) — a single bordered box flowing inline, e.g. a "Place
 * Illustration here" placeholder. The frame's coordinate space is the
 * inline `<wp:extent>`; the textbox fills it (its own xfrm size when
 * present, else the full extent).
 */
function buildBareTextboxFrame(
  inline: Element,
  wsp: Element,
  hostP: Element,
  ctx: InlineFramesContext,
): InlineFrame | null {
  const extent = firstChildNS(inline, NS.wp, "extent");
  const wEmu = numAttr(extent, "cx");
  const hEmu = numAttr(extent, "cy");
  if (wEmu <= 0 || hEmu <= 0) return null;

  const textbox = readInlineTextbox(wsp, ctx);
  if (!textbox) return null;
  // A bare textbox has no intra-group xfrm of its own — it fills the
  // inline extent. Fall back to the extent for any size the shape omitted.
  if (textbox.sizeEmu.wEmu <= 0) textbox.sizeEmu.wEmu = wEmu;
  if (textbox.sizeEmu.hEmu <= 0) textbox.sizeEmu.hEmu = hEmu;

  const pPr = firstChildNS(hostP, NS.w, "pPr");
  const out: InlineFrame = {
    kind: "inline_frame",
    groupExtentEmu: { wEmu, hEmu },
    sizeEmu: { wEmu, hEmu },
    textboxes: [textbox],
    pictures: [],
    shapes: [],
  };
  if (pPr && firstChildNS(pPr, NS.w, "pageBreakBefore") !== null) out.pageBreakBefore = true;
  if (pPr && firstChildNS(pPr, NS.w, "keepNext") !== null) out.keepNext = true;
  return out;
}

/**
 * Build an `InlineFrame` for a BARE `<wps:wsp>` shape (no `<wpg:wgp>`
 * group) — a coloured rectangle flowing inline. The frame's coordinate
 * space is the `<wp:extent>` of the inline drawing itself; the single
 * shape fills it (its own xfrm offset/ext when present, else the full
 * extent).
 */
function buildBareShapeFrame(
  inline: Element,
  wsp: Element,
  hostP: Element,
  ctx: InlineFramesContext,
): InlineFrame | null {
  const extent = firstChildNS(inline, NS.wp, "extent");
  const wEmu = numAttr(extent, "cx");
  const hEmu = numAttr(extent, "cy");
  if (wEmu <= 0 || hEmu <= 0) return null;

  const { off, ext } = readShapeXfrm(wsp);
  const shape: InlineFrame["shapes"][number] = {
    geometry: readGeometry(wsp),
    offsetEmu: { xEmu: off.x, yEmu: off.y },
    sizeEmu: { wEmu: ext.cx > 0 ? ext.cx : wEmu, hEmu: ext.cy > 0 ? ext.cy : hEmu },
  };
  const fill = readSolidFill(wsp, ctx.theme);
  if (fill !== undefined) shape.fill = fill;
  const border = readBorder(wsp, ctx.theme);
  if (border !== undefined) shape.border = border;

  const pPr = firstChildNS(hostP, NS.w, "pPr");
  const out: InlineFrame = {
    kind: "inline_frame",
    groupExtentEmu: { wEmu, hEmu },
    sizeEmu: { wEmu, hEmu },
    textboxes: [],
    pictures: [],
    shapes: [shape],
  };
  if (pPr && firstChildNS(pPr, NS.w, "pageBreakBefore") !== null) out.pageBreakBefore = true;
  if (pPr && firstChildNS(pPr, NS.w, "keepNext") !== null) out.keepNext = true;
  return out;
}

// === low-level OOXML readers ===

function readShapeXfrm(shape: Element): {
  off: { x: number; y: number };
  ext: { cx: number; cy: number };
} {
  // Shape's own offset/extent live on `*:spPr > a:xfrm`. wps:spPr for
  // shapes, pic:spPr for pictures.
  const spPr = firstChildNS(shape, NS.wps, "spPr") ?? firstChildNS(shape, NS.pic, "spPr");
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
      if (child.localName === "lastRenderedPageBreak" && child.namespaceURI === NS.w) {
        return true;
      }
      stack.push(child);
    }
  }
  return false;
}
