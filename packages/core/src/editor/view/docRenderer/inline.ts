import { resolveRunStyle } from "../../../doc/styles";
import type {
  HyperlinkRun,
  InlineRun,
  NamedStyle,
  RunProperties,
  TextRun,
} from "../../../doc/types";
import {
  CLS_COMMENT_RANGE,
  CLS_REVISION,
  CLS_REVISION_FORMAT,
  COMMENT_IDS_ATTR,
  REVISION_AUTHOR_ATTR,
  REVISION_DATE_ATTR,
  REVISION_FORMAT_AUTHOR_ATTR,
  REVISION_FORMAT_DATE_ATTR,
} from "../../renderedDocument/selectors";
import { resolveFontFace } from "./fontFallback";

/**
 * Render a list of InlineRuns into DOM children of `parent`. Empty run
 * lists produce a `<br>` placeholder so contenteditable can place a
 * caret in the paragraph.
 *
 * `rawParts` is threaded through so `DrawingRun` can resolve its
 * `partPath` to an `<img src>` via a blob URL / data URI.
 */
export function appendInlineRuns(
  parent: HTMLElement,
  runs: readonly InlineRun[],
  rawParts: Record<string, Uint8Array> = {},
  styles: readonly NamedStyle[] = [],
): void {
  if (runs.length === 0) {
    parent.appendChild(document.createElement("br"));
    return;
  }
  for (const run of runs) {
    const node = renderRun(run, rawParts, styles);
    if (node) parent.appendChild(node);
  }
}

function renderRun(
  run: InlineRun,
  rawParts: Record<string, Uint8Array>,
  styles: readonly NamedStyle[],
): Node | null {
  switch (run.kind) {
    case "text":
      return renderTextRun(run, styles);
    case "break":
      if (run.type === "line") return document.createElement("br");
      if (run.type === "page") {
        const div = document.createElement("div");
        div.className = "page-break";
        div.setAttribute("data-page-break", "");
        div.setAttribute("contenteditable", "false");
        return div;
      }
      if (run.type === "column") {
        // Column-break runs are hoisted onto the containing paragraph
        // via `break-before: column` in `renderParagraph` (see
        // block.ts → cascadeColumnBreak). The inline run itself
        // collapses to nothing so the paragraph layout stays clean.
        return null;
      }
      return null;
    case "tab":
      return document.createTextNode("\t");
    case "field": {
      // Wrap in a span tagged with the field instruction so per-page
      // contexts (header/footer renderers) can substitute the live
      // PAGE / NUMPAGES value. Body rendering leaves the cached text
      // as-is — the span is invisible to layout.
      const span = document.createElement("span");
      span.className = "sobree-field";
      span.dataset.field = run.instruction;
      span.textContent = run.cached ?? "";
      return span;
    }
    case "drawing":
      return renderDrawing(run, rawParts);
    case "hyperlink":
      return renderHyperlink(run, rawParts, styles);
    case "footnoteRef":
      return renderFootnoteRef(run);
    case "commentRef":
      return renderCommentRef(run);
    default:
      return null;
  }
}

/**
 * Render a footnote reference as a clickable superscript anchor.
 * `href="#sobree-footnote-N"` points at the matching `<li>` in the
 * footnotes container that the renderer appends at the end of the body.
 */
function renderFootnoteRef(run: import("../../../doc/types").FootnoteRefRun): HTMLElement {
  const sup = document.createElement("sup");
  sup.className = "sobree-footnote-ref";
  const link = document.createElement("a");
  link.setAttribute("href", `#sobree-footnote-${run.id}`);
  link.setAttribute("id", `sobree-footnote-ref-${run.id}`);
  // A custom mark (`<w:footnoteReference w:customMarkFollows>`) replaces the
  // auto-number — e.g. an author "*" footnote.
  link.textContent = run.customMark ?? String(run.id);
  sup.appendChild(link);
  return sup;
}

/**
 * Render a comment reference as a small balloon glyph linking to the
 * comment card in the comments aside / per-page zone. Word draws a
 * speech-bubble icon; we use the U+1F4AC character ("💬") as a
 * lightweight stand-in that needs no SVG.
 */
function renderCommentRef(run: import("../../../doc/types").CommentRefRun): HTMLElement {
  const span = document.createElement("span");
  span.className = "sobree-comment-ref";
  const link = document.createElement("a");
  link.setAttribute("href", `#sobree-comment-${run.id}`);
  link.setAttribute("id", `sobree-comment-ref-${run.id}`);
  link.setAttribute("aria-label", `Comment ${run.id}`);
  link.textContent = "\u{1F4AC}";
  span.appendChild(link);
  return span;
}

/**
 * Render a TextRun by:
 *   1. Creating the innermost text node.
 *   2. Wrapping it in semantic tags (`<strong>`, `<em>`, `<u>`, `<s>`,
 *      `<sub>`/`<sup>`) for every property that has one.
 *   3. Wrapping once in `<span style="...">` for the rest (colour,
 *      highlight, font family/size) if any apply.
 *
 * The DOM shape round-trips cleanly through the serializer which walks
 * these wrappers back into a single flat `RunProperties`.
 */
function renderTextRun(run: TextRun, styles: readonly NamedStyle[] = []): Node {
  let node: Node = document.createTextNode(run.text);
  // A run character style (`<w:rStyle>`) contributes its rPr UNDER any
  // direct run formatting — Word's cascade order (char style < direct
  // rPr). resolveStyleCascade returns the char style's own properties
  // (character styles don't chain to DocDefaults), so the run's font /
  // size still inherit from the paragraph; only what the char style sets
  // (colour, underline, …) is added.
  const p: RunProperties =
    run.properties.styleId && styles.length > 0
      ? { ...resolveRunStyle(styles, run.properties.styleId), ...run.properties }
      : run.properties;

  if (p.verticalAlign === "superscript") node = wrap("sup", node);
  else if (p.verticalAlign === "subscript") node = wrap("sub", node);

  if (p.strike) node = wrap("s", node);
  if (p.underline && p.underline !== "none") node = wrap("u", node);
  if (p.italic) node = wrap("em", node);
  if (p.bold) node = wrap("strong", node);

  const style = cssFromRunProps(p);
  // `<w:vanish/>` (hidden text) — always tagged with `sobree-hidden`; CSS
  // hides it by default and reveals it (dotted underline) only when the
  // editor root carries `sobree-show-hidden` (toggled via the
  // `showHiddenText` option / `setShowHiddenText`). Keeping it class-driven
  // means the toggle is a single class flip, no re-render.
  if (style || p.hidden) {
    const span = document.createElement("span");
    if (style) span.setAttribute("style", style);
    if (p.hidden) span.className = "sobree-hidden";
    span.appendChild(node);
    node = span;
  }
  // Format-change wrapper — `<span class="sobree-revision-format">`
  // for runs whose properties were tracked-changed (`<w:rPrChange>` /
  // `RunProperties.revisionFormat`). Carries the author so the review
  // plugin can colour the visual hint and surface a hover popover that
  // dispatches to `editor.acceptFormatRevision` /
  // `rejectFormatRevision`. Wraps INSIDE ins/del so a run that was
  // both inserted AND format-changed still hovers each independently.
  if (p.revisionFormat) {
    const wrapper = document.createElement("span");
    wrapper.className = CLS_REVISION_FORMAT;
    if (p.revisionFormat.author) {
      wrapper.setAttribute(REVISION_FORMAT_AUTHOR_ATTR, p.revisionFormat.author);
    }
    if (p.revisionFormat.date) {
      wrapper.setAttribute(REVISION_FORMAT_DATE_ATTR, p.revisionFormat.date);
    }
    wrapper.appendChild(node);
    node = wrapper;
  }
  // Tracked-change wrapper — `<ins>` / `<del>` semantically tag the
  // text as an insertion / deletion. Core ships *neutral* styling
  // (underline / strikethrough) so changes are always visible, even
  // with no review plugin. `data-revision-author` / `-date` carry the
  // metadata; the `@sobree/review` plugin reads `data-revision-author`
  // to apply per-author colour.
  if (p.revision) {
    const tag = p.revision.type === "ins" ? "ins" : "del";
    const wrapper = document.createElement(tag);
    wrapper.className = `${CLS_REVISION} ${CLS_REVISION}-${p.revision.type}`;
    if (p.revision.author) wrapper.setAttribute(REVISION_AUTHOR_ATTR, p.revision.author);
    if (p.revision.date) wrapper.setAttribute(REVISION_DATE_ATTR, p.revision.date);
    wrapper.appendChild(node);
    node = wrapper;
  }
  // Comment-range highlight — wrap in a `<span class="sobree-comment-range">`
  // anchored to the comment ids via `data-comment-ids="N,M"`. Core draws
  // a faint neutral highlight so the commented span is visible; the
  // `@sobree/review` plugin reads `data-comment-ids` to place the
  // comment cards.
  if (p.commentIds && p.commentIds.length > 0) {
    const wrapper = document.createElement("span");
    wrapper.className = CLS_COMMENT_RANGE;
    wrapper.setAttribute(COMMENT_IDS_ATTR, p.commentIds.join(","));
    wrapper.appendChild(node);
    node = wrapper;
  }
  return node;
}

function renderHyperlink(
  link: HyperlinkRun,
  rawParts: Record<string, Uint8Array>,
  styles: readonly NamedStyle[] = [],
): Node {
  const a = document.createElement("a");
  a.setAttribute("href", link.href);
  appendInlineRuns(a, link.children, rawParts, styles);
  return a;
}

function renderDrawing(
  d: import("../../../doc/types").DrawingRun,
  rawParts: Record<string, Uint8Array>,
): Node {
  const img = document.createElement("img");
  img.setAttribute("data-part", d.partPath);
  if (d.altText) img.setAttribute("alt", d.altText);
  const url = partPathToUrl(d.partPath, rawParts);
  if (url) img.setAttribute("src", url);
  if (d.widthEmu > 0) img.style.width = `${emuToPx(d.widthEmu)}px`;
  if (d.heightEmu > 0) img.style.height = `${emuToPx(d.heightEmu)}px`;
  if (d.verticalAlign === "middle") img.style.verticalAlign = "middle";
  if (d.placement === "anchor" && d.anchor) applyAnchorPositioning(img, d.anchor);
  else if (d.placement === "floatLeft" || d.placement === "floatRight") {
    applyFloat(img, d);
  }
  return img;
}

/**
 * A displacing-wrap anchored image rendered as a CSS float at the head of
 * its anchor paragraph: the browser shortens the line boxes of this
 * paragraph AND the following ones until the float's height is exhausted —
 * exactly how Word wraps body text around the image. `floatMarginsEmu`
 * carries the OOXML `distT/B/L/R` clearance straight onto the box.
 */
function applyFloat(img: HTMLImageElement, d: import("../../../doc/types").DrawingRun): void {
  img.style.float = d.placement === "floatLeft" ? "left" : "right";
  const m = d.floatMarginsEmu;
  if (m) {
    img.style.margin =
      `${emuToMm(m.topEmu)}mm ${emuToMm(m.rightEmu)}mm ` +
      `${emuToMm(m.bottomEmu)}mm ${emuToMm(m.leftEmu)}mm`;
  }
}

/**
 * Apply CSS positioning to a floating (`<wp:anchor>`) image. We use
 * `position: absolute` with offsets in millimetres, sized into whichever
 * ancestor the paper stack provides as the positioning frame.
 *
 * The `relativeFrom` axis values collapse to two cases:
 *   - "page" / "margin" / "column" / "paragraph" / "line"
 *     → all become positions inside the **paper-content** box (the
 *       text area). Strictly accurate `relativeFrom: page` would
 *       measure from the paper edge including margins, but for the
 *       common case of margin-anchored figures the difference is one
 *       margin and the visual is close enough until a fixture forces
 *       finer calibration.
 *
 * `data-anchor-h` / `data-anchor-v` carry the original `relativeFrom`
 * values for downstream diagnosis / future tightening.
 */
function applyAnchorPositioning(
  img: HTMLImageElement,
  anchor: import("../../../doc/types").DrawingAnchor,
): void {
  img.style.position = "absolute";
  img.style.left = `${emuToMm(anchor.offsetXEmu)}mm`;
  img.style.top = `${emuToMm(anchor.offsetYEmu)}mm`;
  if (anchor.behindDoc) img.style.zIndex = "-1";
  img.dataset.anchorH = anchor.relativeFromH;
  img.dataset.anchorV = anchor.relativeFromV;
}

function emuToMm(emu: number): number {
  // 914400 EMU per inch, 25.4mm per inch.
  return Math.round((emu / 914400) * 25.4 * 100) / 100;
}

/** Convert a raw part's bytes (from `doc.rawParts`) into a blob URL
 *  the browser can render as `<img src>` / `background-image`. Exported
 *  for the section-frame renderer in `block.ts` which paints the
 *  `framePictures` background outside the inline-run code path. */
export function partPathToUrl(
  partPath: string,
  rawParts: Record<string, Uint8Array>,
): string | null {
  const bytes = rawParts[partPath];
  if (!bytes) return null;
  // jsdom (test runner) lacks `URL.createObjectURL`; fall back to a
  // data: URI so the renderer produces a stable string the snapshot
  // can compare against without hitting browser-only APIs.
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return `data:${mimeFromPath(partPath)};base64,${bytesToBase64(bytes)}`;
  }
  return bytesToObjectUrl(bytes, mimeFromPath(partPath));
}

function bytesToBase64(bytes: Uint8Array): string {
  // Naive batched encoder — fine for the small PNGs (max ~5 KB) used
  // for section-frame decorations in our corpus.
  let str = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    str += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  if (typeof btoa === "function") return btoa(str);
  // Node fallback (no global `btoa`): reach `Buffer` via `globalThis`
  // with a structural cast, so a browser-only consumer's `.d.ts` build
  // doesn't need `@types/node`. Same runtime behaviour as `Buffer.from`.
  const nodeBuffer = (
    globalThis as {
      Buffer?: { from(s: string, enc: string): { toString(enc: string): string } };
    }
  ).Buffer;
  if (!nodeBuffer) throw new Error("bytesToBase64: no `btoa` or `Buffer` available.");
  return nodeBuffer.from(str, "binary").toString("base64");
}

function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  return "application/octet-stream";
}

function bytesToObjectUrl(bytes: Uint8Array, mime: string): string {
  // Copy into a fresh Uint8Array so the Blob's typed-array has a
  // plain `ArrayBuffer` (not `SharedArrayBuffer`), satisfying strict
  // `BlobPart` typing.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mime });
  return URL.createObjectURL(blob);
}

function emuToPx(emu: number): number {
  // 914400 EMU per inch, 96 px per inch at default DPI.
  return Math.round((emu / 914400) * 96);
}

function wrap(tag: "strong" | "em" | "u" | "s" | "sub" | "sup", child: Node): HTMLElement {
  const el = document.createElement(tag);
  el.appendChild(child);
  return el;
}

/**
 * Translate the presentation-level bits of RunProperties into a CSS
 * `style` string. Returns `null` when nothing matches so the caller can
 * skip wrapping in `<span>`.
 */
function cssFromRunProps(p: RunProperties): string | null {
  const decls: string[] = [];
  // `auto` is OOXML's automatic colour — render as currentColor so it
  // overrides any inherited colour back to the document text colour.
  if (p.color) decls.push(`color:${p.color === "auto" ? "currentColor" : p.color}`);
  if (p.highlight) decls.push(`background:${normaliseHighlight(p.highlight)}`);
  // `<w:shd w:fill>` on the run — a background fill distinct from
  // `<w:highlight>` (highlight is a fixed palette; shd is any colour).
  // A real fill wins over highlight when both are present.
  if (p.shading?.fill && p.shading.fill !== "auto" && p.shading.fill !== "#auto") {
    decls.push(`background:${p.shading.fill}`);
  }
  if (p.fontFamily) {
    const face = resolveFontFace(p.fontFamily);
    decls.push(`font-family:${face.stack}`);
    // The face name's implied weight/style — but a span's font-weight
    // would override the OUTER <strong>/<em> wrappers, so the run's own
    // bold/italic win by suppressing the implied value.
    if (face.weight !== undefined && !p.bold) decls.push(`font-weight:${face.weight}`);
    if (face.italic && !p.italic) decls.push("font-style:italic");
  }
  if (p.fontSizePt !== undefined) decls.push(`font-size:${p.fontSizePt}pt`);
  // `<w:caps/>` → CSS `text-transform: uppercase`. The source text
  // keeps its mixed-case characters (round-trip), the display is
  // uppercased. healthcare-with-photo's "Peter Burkimsher" name run
  // carries `caps`; rendering as-is shows lowercase, which mismatches
  // Word/LO's all-caps banner label.
  if (p.caps) decls.push("text-transform:uppercase");
  // `<w:smallCaps/>` — lowercase letters render as small capitals.
  if (p.smallCaps) decls.push("font-variant-caps:small-caps");
  // `<w:dstrike/>` — a DOUBLE strikethrough. The single `<w:strike/>`
  // is the `<s>` wrapper above; this is its own CSS so the two are
  // independent (a run is one or the other in practice).
  if (p.doubleStrike) decls.push("text-decoration:line-through double");
  return decls.length > 0 ? decls.join(";") : null;
}

function normaliseHighlight(v: string): string {
  if (v.startsWith("#")) return v;
  const map: Record<string, string> = {
    yellow: "#ffff00",
    green: "#00ff00",
    cyan: "#00ffff",
    magenta: "#ff00ff",
    blue: "#0000ff",
    red: "#ff0000",
    darkYellow: "#808000",
  };
  return map[v] ?? v;
}
