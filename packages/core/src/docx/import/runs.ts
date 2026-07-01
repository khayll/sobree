import type { RunProperties } from "../../doc/types";
import { NS } from "../shared/namespaces";
import { wFirst } from "../shared/xml";
import { readRunProperties } from "./runProperties";

/** Frame-of-reference choices the importer carries through; mapped 1:1 to
 *  the `DrawingAnchor.relativeFromH` / `relativeFromV` AST values. */
export interface ImportedAnchor {
  offsetXEmu: number;
  offsetYEmu: number;
  relativeFromH: "page" | "margin" | "column" | "character";
  relativeFromV: "page" | "margin" | "paragraph" | "line";
  behindDoc?: boolean;
}

/** Drawing info extracted from a `<w:drawing>` inside a run. */
export interface ImportedDrawing {
  /** Relationship id of the embedded image (`<a:blip r:embed="rIdN"/>`). */
  embedRelId?: string;
  widthEmu?: number;
  heightEmu?: number;
  altText?: string;
  /** Present when the drawing is a `<wp:anchor>` (floating) rather than
   *  `<wp:inline>`. The renderer positions the image absolutely via
   *  these coordinates. */
  anchor?: ImportedAnchor;
}

/**
 * Read a `<w:r>` element into a `{ text, format }` pair. The document
 * converter maps the format flags onto the native `RunProperties` shape.
 */
export interface ImportedRun {
  text: string;
  format: RunProperties;
  /** True if this run was `<w:br/>`; `text` is empty in that case. */
  isHardBreak: boolean;
  /** Type of break for `isHardBreak` runs — line (Shift-Enter), page
   *  (force new page), or column (force next column in a multi-column
   *  section). Defaults to "line" when omitted. */
  breakType?: "line" | "page" | "column";
  /** Set when the run wraps an inline `<w:drawing>` (image). */
  drawing?: ImportedDrawing;
  /** Set when the run wraps a `<w:footnoteReference w:id="N"/>`. */
  footnoteRefId?: number;
  /** Custom mark from `<w:footnoteReference w:customMarkFollows="1">` —
   *  the literal text following the reference in the same run (e.g. `"*"`)
   *  that replaces the auto-number. */
  footnoteCustomMark?: string;
  /** Set when the run wraps a `<w:commentReference w:id="N"/>`. */
  commentRefId?: number;
  /** Set when the run is inside a `<w:ins>` / `<w:del>` wrapper. */
  revision?: { type: "ins" | "del"; author?: string; date?: string };
  /** Set when the run is between a `<w:commentRangeStart w:id="N"/>`
   *  and matching `<w:commentRangeEnd>`. Multiple ids when nested /
   *  overlapping comments cover the run. */
  commentIds?: readonly number[];
  /**
   * Set when the source was a `<w:fldSimple w:instr="...">`. The
   * paragraph converter emits a `FieldRun` from this — used for
   * page-number tokens (`PAGE` / `NUMPAGES`) in headers and footers
   * so the round-trip through `blocksToTemplate` preserves `{page}` /
   * `{pages}`.
   */
  field?: { instruction: string; cached?: string };
}

export function readRun(r: Element): ImportedRun {
  // Hard break — emitted as its own run with no text. Word distinguishes
  // line / page / column breaks via `<w:br w:type="...">`. Column
  // breaks are critical for multi-column form layouts (jellap.docx
  // uses one to push subsequent fields to the right column so they
  // pair as table rows).
  const brEl = wFirst(r, "br");
  if (brEl) {
    const typeAttr = brEl.getAttributeNS(NS.w, "type") ?? brEl.getAttribute("w:type");
    const breakType: "line" | "page" | "column" =
      typeAttr === "page" ? "page" : typeAttr === "column" ? "column" : "line";
    return { text: "", format: {}, isHardBreak: true, breakType };
  }

  // Drawing (image). Inline placement renders in the paragraph; anchor
  // placement is now handled by the per-page anchor layer
  // (`parseAnchoredFrames` + `renderAnchorLayer`). When we encounter
  // an `<wp:anchor>` drawing here, return an empty run so the new
  // layer is the SOLE paint path — without this, runs.ts would emit
  // a full-extent inline DrawingRun for every anchored shape, which
  // the inline renderer paints at the natural picture size (huge
  // arrows / decorative bands intruding into body flow).
  const drawing = wFirst(r, "drawing");
  if (drawing) {
    const anchorEl = drawing.getElementsByTagNameNS(NS.wp, "anchor")[0];
    if (anchorEl) {
      return { text: "", format: {}, isHardBreak: false };
    }
    const info = readDrawing(drawing);
    return { text: "", format: {}, isHardBreak: false, drawing: info };
  }

  // Legacy VML object: `<w:object>` (OLE embeds, often used by older
  // Word versions and templates) and `<w:pict>` (VML-only pictures).
  // Both can wrap a `<v:shape>` containing `<v:imagedata r:id="...">`
  // — the OLE-fallback image path templates use for badge/logo art.
  // Read the VML imagedata as a regular DrawingRun so the renderer can
  // show the image; without this, OLE-only pictures vanish from the
  // import.
  const vmlContainer = wFirst(r, "object") ?? wFirst(r, "pict");
  if (vmlContainer) {
    const info = readVmlImage(vmlContainer);
    if (info) return { text: "", format: {}, isHardBreak: false, drawing: info };
  }

  // Footnote reference — `<w:footnoteReference w:id="N"/>`. The body
  // text of footnote N lives in `word/footnotes.xml`, parsed
  // separately into `SobreeDocument.footnotes[N]`.
  const footnoteRef = wFirst(r, "footnoteReference");
  if (footnoteRef) {
    const idAttr = footnoteRef.getAttributeNS(NS.w, "id") ?? footnoteRef.getAttribute("w:id");
    const id = Number(idAttr);
    if (Number.isFinite(id) && id >= 1) {
      // `customMarkFollows` ⇒ the auto-number is suppressed and the run's
      // trailing `<w:t>` text (e.g. "*") IS the reference mark. Capture it so
      // the renderer shows the mark instead of the number; without this the
      // mark text was also dropped by the early return.
      const custom =
        footnoteRef.getAttributeNS(NS.w, "customMarkFollows") ??
        footnoteRef.getAttribute("w:customMarkFollows");
      const customMark = custom === "1" || custom === "true" ? readRunText(r) : "";
      return {
        text: "",
        format: {},
        isHardBreak: false,
        footnoteRefId: id,
        ...(customMark ? { footnoteCustomMark: customMark } : {}),
      };
    }
  }

  // Comment reference — `<w:commentReference w:id="N"/>`. Word draws
  // a balloon glyph at the position; we mirror with a clickable inline
  // span. The actual comment text lives in `SobreeDocument.comments[N]`.
  const commentRef = wFirst(r, "commentReference");
  if (commentRef) {
    const idAttr = commentRef.getAttributeNS(NS.w, "id") ?? commentRef.getAttribute("w:id");
    const id = Number(idAttr);
    if (Number.isFinite(id) && id >= 0) {
      return { text: "", format: {}, isHardBreak: false, commentRefId: id };
    }
  }

  // Walk the run's children in document order so interleaved
  // `<w:t>` / `<w:tab/>` / `<w:delText>` elements get concatenated in
  // the right sequence. The earlier `join the <w:t> texts` shortcut
  // silently dropped tabs — fatal for Word headers like jellap.docx
  // where "Cím:" → `<w:tab/>` → "1012 Budapest" relies on the tab to
  // separate label and value. We emit a real tab character `\t`;
  // combined with `white-space: pre-wrap` on body paragraphs the
  // browser renders it as a tab stop (default tab-size; honouring the
  // paragraph's own `<w:tabs>` stops is a follow-up).
  let text = "";
  for (const child of Array.from(r.children)) {
    if (child.namespaceURI !== NS.w) continue;
    if (child.localName === "t" || child.localName === "delText") {
      text += child.textContent ?? "";
    } else if (child.localName === "tab") {
      text += "\t";
    }
    // Other children (rPr, br, drawing, footnoteReference, …) are
    // handled by the dedicated branches above before we reach here.
  }

  text = normaliseRunText(text);

  // `<w:rPr>` — direct run formatting. Parsed by the ONE shared reader
  // (the same `readRunProperties` the style importer uses) so the two
  // `<w:rPr>` homes can't drift; it also folds in the nested
  // `<w:rPrChange>` format-revision snapshot.
  const rPr = wFirst(r, "rPr");
  const format: RunProperties = (rPr ? readRunProperties(rPr) : undefined) ?? {};

  return { text, format, isHardBreak: false };
}

/**
 * Pull-in normalisation for `<w:t>` content. Word renders certain
 * source artefacts visually differently from how a browser would:
 *
 *   - **Long whitespace runs** — authors use 50-100 literal spaces to
 *     push a label to the right column. Word renders these spaces at
 *     a narrower glyph width than browsers (Calibri spaces about 2pt
 *     vs browser-fallback about 3.5pt). To stop the row from wrapping
 *     in Sobree, collapse pure-whitespace runs of 4+ chars to a single
 *     space. Tabs are not collapsed - they are preserved verbatim
 *     because jellap.docx (and many forms) lean on `<w:tab/>` for
 *     alignment.
 *
 * The transform runs at IMPORT time. Ellipsis (U+2026) characters are
 * NOT substituted here - they keep their original codepoint so the
 * renderer can apply CSS letter-spacing tightening that preserves the
 * dot-leader visual without touching the AST.
 */
/** Concatenate a run's `<w:t>` text in document order (tabs → `\t`).
 *  Used to capture a footnote's custom mark, which trails the
 *  `<w:footnoteReference>` as plain text in the same run. */
function readRunText(r: Element): string {
  let text = "";
  for (const child of Array.from(r.children)) {
    if (child.namespaceURI !== NS.w) continue;
    if (child.localName === "t" || child.localName === "delText") text += child.textContent ?? "";
    else if (child.localName === "tab") text += "\t";
  }
  return text.trim();
}

function normaliseRunText(text: string): string {
  if (!text) return text;
  if (text.includes("\t")) return text;
  if (text.length >= 4 && /^[ \u00A0]+$/.test(text)) return " ";
  return text;
}

/**
 * Walk into a `<w:drawing>` to pull out the embed id (rId of the image
 * relationship), the extent (in EMU), any docPr description used as
 * alt text, and — for `<wp:anchor>` drawings — the position offsets +
 * frame of reference.
 */
/**
 * Read a VML image container (`<w:object>` for OLE embeds, `<w:pict>`
 * for VML-only pictures) into the same `ImportedDrawing` shape the
 * DrawingML path produces. The renderer doesn't care about the source
 * format — it just needs the embedded image's rId and the rendered
 * pixel extent.
 *
 * VML expresses size via `<v:shape style="width:Xpt;height:Ypt">`; we
 * parse the inline style to recover the EMU extent (1pt = 12700 EMU).
 * Returns null when the container has no `<v:imagedata>` (pure shape
 * with no image — rare in real-world docs).
 */
function readVmlImage(container: Element): ImportedDrawing | null {
  // `<v:imagedata>` is the OLE/VML equivalent of `<a:blip>`. Search
  // anywhere under the container; older Word versions nest it inside
  // `<v:shape>` which itself may be inside multiple wrapping elements.
  const V_NS = "urn:schemas-microsoft-com:vml";
  const imagedata = container.getElementsByTagNameNS(V_NS, "imagedata")[0];
  if (!imagedata) return null;
  const rId = imagedata.getAttributeNS(NS.r, "id") ?? imagedata.getAttribute("r:id");
  if (!rId) return null;
  const out: ImportedDrawing = { embedRelId: rId };
  // VML size lives in the `<v:shape style="...">` attribute. Parse
  // "width:Xpt;height:Ypt" or "width:Xin;height:Yin" forms.
  const shape = container.getElementsByTagNameNS(V_NS, "shape")[0];
  const style = shape?.getAttribute("style") ?? "";
  const widthPt = parseVmlDimension(style.match(/width:\s*([\d.]+)([a-z%]*)/i));
  const heightPt = parseVmlDimension(style.match(/height:\s*([\d.]+)([a-z%]*)/i));
  if (widthPt > 0) out.widthEmu = Math.round(widthPt * 12700);
  if (heightPt > 0) out.heightEmu = Math.round(heightPt * 12700);
  // VML doesn't carry alt text in a portable place — leave undefined.
  return out;
}

/** Convert a CSS-style numeric+unit match into points. */
function parseVmlDimension(match: RegExpMatchArray | null): number {
  if (!match) return 0;
  const v = Number(match[1]);
  if (!Number.isFinite(v) || v <= 0) return 0;
  const unit = (match[2] ?? "pt").toLowerCase();
  switch (unit) {
    case "pt":
      return v;
    case "in":
      return v * 72;
    case "px":
      return v * 0.75;
    case "mm":
      return (v / 25.4) * 72;
    case "cm":
      return (v / 2.54) * 72;
    default:
      return v; // assume pt for unitless
  }
}

function readDrawing(drawing: Element): ImportedDrawing {
  const out: ImportedDrawing = {};
  const inlineEl = drawing.getElementsByTagNameNS(NS.wp, "inline")[0];
  const anchorEl = drawing.getElementsByTagNameNS(NS.wp, "anchor")[0];
  const wpRoot = inlineEl ?? anchorEl;
  const blip = drawing.getElementsByTagNameNS(NS.a, "blip")[0];
  if (blip) {
    const rId = blip.getAttributeNS(NS.r, "embed") ?? blip.getAttribute("r:embed");
    if (rId) out.embedRelId = rId;
  }
  const extent = wpRoot?.getElementsByTagNameNS(NS.wp, "extent")[0];
  if (extent) {
    const cx = Number(extent.getAttribute("cx"));
    const cy = Number(extent.getAttribute("cy"));
    if (Number.isFinite(cx) && cx > 0) out.widthEmu = cx;
    if (Number.isFinite(cy) && cy > 0) out.heightEmu = cy;
  }
  const docPr = wpRoot?.getElementsByTagNameNS(NS.wp, "docPr")[0];
  if (docPr) {
    const descr = docPr.getAttribute("descr") ?? docPr.getAttribute("title");
    if (descr) out.altText = descr;
  }
  if (anchorEl) {
    out.anchor = readAnchor(anchorEl);
  }
  return out;
}

/**
 * Parse the position metadata from a `<wp:anchor>` element. Each axis
 * carries a `relativeFrom` (the frame of reference — page corner,
 * margin corner, paragraph baseline, etc.) and a `posOffset` in EMU.
 * `<wp:align>` (left/center/right) is *not* yet parsed — when present
 * we fall back to offset 0 with the default frame; calibration can
 * land that when a fixture surfaces it.
 */
function readAnchor(anchor: Element): ImportedAnchor {
  const posH = anchor.getElementsByTagNameNS(NS.wp, "positionH")[0];
  const posV = anchor.getElementsByTagNameNS(NS.wp, "positionV")[0];
  const behindDoc = anchor.getAttribute("behindDoc") === "1";
  const out: ImportedAnchor = {
    offsetXEmu: readPosOffset(posH),
    offsetYEmu: readPosOffset(posV),
    relativeFromH: normaliseRelativeFromH(posH?.getAttribute("relativeFrom") ?? "column"),
    relativeFromV: normaliseRelativeFromV(posV?.getAttribute("relativeFrom") ?? "paragraph"),
  };
  if (behindDoc) out.behindDoc = true;
  return out;
}

function readPosOffset(positionEl: Element | undefined): number {
  if (!positionEl) return 0;
  const posOffset = positionEl.getElementsByTagNameNS(NS.wp, "posOffset")[0];
  if (!posOffset) return 0;
  const n = Number(posOffset.textContent ?? "0");
  return Number.isFinite(n) ? n : 0;
}

function normaliseRelativeFromH(v: string): ImportedAnchor["relativeFromH"] {
  if (v === "page" || v === "margin" || v === "character") return v;
  // "column", "leftMargin", "rightMargin", "insideMargin", "outsideMargin"
  // all collapse to "column" for our coarse renderer — close enough for
  // single-column docs (the typical floating-image case).
  return "column";
}

function normaliseRelativeFromV(v: string): ImportedAnchor["relativeFromV"] {
  if (v === "page" || v === "margin" || v === "line") return v;
  // "paragraph", "topMargin", "bottomMargin", "insideMargin", "outsideMargin"
  // collapse to "paragraph".
  return "paragraph";
}
