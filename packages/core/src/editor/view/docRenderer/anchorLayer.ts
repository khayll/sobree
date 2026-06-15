/**
 * Render an `AnchoredFrame[]` list to a single absolute-positioned DOM
 * subtree — the per-page floating layer.
 *
 * Used by `PaperStack` once per paper: after distributing body blocks
 * into pages, each paper gets a sibling `<div class="paper-anchors">`
 * containing the frames that resolved to that page. The layer covers
 * the paper-content area, child frames are positioned with `left/top`
 * in millimetres converted from EMU at paint time.
 *
 * Why a separate layer (vs inlining into body flow):
 *   - The paginator stays oblivious to floating content. Body blocks
 *     are the only thing it splits across pages.
 *   - Each frame is exactly one DOM element. Selection / drag / resize
 *     can latch onto it without needing to chase synthetic siblings.
 *   - Overflow inside textboxes clips (Word behaviour) because the
 *     frame's element has `overflow: hidden` — no chance of a long
 *     textbox spilling into the next page's layout.
 *
 * Pure function. Takes frames + page dimensions + the binary parts
 * map (to resolve picture URLs), returns a fresh element. Repeated
 * calls produce equivalent DOM — safe to swap out wholesale.
 */

import type { AnchoredContent, AnchoredFrame, Block } from "../../../doc/types";
import { emuToMm, emuToPx } from "./units";

export interface AnchorLayerContext {
  /** Map ZIP-path → bytes, used to mint blob URLs for picture content. */
  rawParts: Record<string, Uint8Array>;
  /**
   * Reuse picture URLs across calls so the same image isn't re-blobbed
   * every render. The caller (PaperStack) owns the map.
   */
  pictureUrlCache: Map<string, string>;
  /**
   * Render a textbox's `Block[]` body into a host element. Injected by
   * the caller (PaperStack wires in `renderBlocks`) so this module
   * stays decoupled from the heavy block renderer — anchorLayer only
   * knows the AnchoredFrame model + DOM, not the full paragraph/list/
   * table pipeline. When absent, textbox bodies render as plain
   * stacked text (test/headless fallback).
   */
  renderBody?: (blocks: Block[], host: HTMLElement) => void;
}

/**
 * Build the per-page anchor layer. Returns a single `<div>` whose
 * children are the frames — render order = z-stack order (later
 * siblings paint on top). The wrapper itself is `position: absolute`
 * inset:0 inside the paper-content area.
 */
export function renderAnchorLayer(
  frames: readonly AnchoredFrame[],
  ctx: AnchorLayerContext,
): HTMLElement {
  const layer = document.createElement("div");
  layer.className = "paper-anchors";
  layer.style.position = "absolute";
  layer.style.inset = "0";
  // Without a stacking context the frames' z-index values would escape
  // to the document root and fight with editor chrome (toolbars,
  // selection rectangles). Pin them here.
  layer.style.isolation = "isolate";
  layer.style.pointerEvents = "none";

  for (const frame of frames) {
    layer.appendChild(renderFrame(frame, ctx));
  }
  return layer;
}

function renderFrame(frame: AnchoredFrame, ctx: AnchorLayerContext): HTMLElement {
  const el = document.createElement("div");
  el.className = "paper-anchor";
  el.dataset.anchorId = frame.id;
  el.style.position = "absolute";
  el.style.left = `${emuToMm(frame.offsetXEmu)}mm`;
  el.style.top = `${emuToMm(frame.offsetYEmu)}mm`;
  el.style.width = `${emuToMm(frame.widthEmu)}mm`;
  el.style.height = `${emuToMm(frame.heightEmu)}mm`;
  el.style.overflow = "hidden";
  el.style.boxSizing = "border-box";
  // `behindText` is NOT expressed here: the overlay layers are isolated
  // stacking contexts, so no z-index a frame sets from inside can drop it
  // below the body text. The Paper routes behind-text frames into the
  // dedicated `.paper-anchors-behind` layer instead; within either layer
  // only the frame's relative stacking matters.
  if (frame.zIndex !== undefined) el.style.zIndex = String(frame.zIndex);
  // Let pointer events through to the body by default; selection
  // wiring (a follow-up step) will re-enable per-frame as needed.
  el.style.pointerEvents = "none";

  paintContent(el, frame, ctx);
  return el;
}

function paintContent(host: HTMLElement, frame: AnchoredFrame, ctx: AnchorLayerContext): void {
  const c = frame.content;
  switch (c.kind) {
    case "picture":
      paintPicture(host, c, ctx);
      break;
    case "shape":
      paintShape(host, c);
      break;
    case "textbox":
      paintTextbox(host, c, ctx);
      break;
    case "group":
      paintGroup(host, c, frame.widthEmu, frame.heightEmu, ctx);
      break;
  }
}

function paintPicture(
  host: HTMLElement,
  content: Extract<AnchoredContent, { kind: "picture" }>,
  ctx: AnchorLayerContext,
): void {
  const url = resolvePictureUrl(content.partPath, ctx);
  if (!url) return;
  const img = document.createElement("img");
  img.src = url;
  img.alt = content.altText ?? "";
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.display = "block";
  img.style.objectFit = "fill";
  host.appendChild(img);
}

const SVG_NS = "http://www.w3.org/2000/svg";

function paintShape(host: HTMLElement, content: Extract<AnchoredContent, { kind: "shape" }>): void {
  // Custom geometry paints as an SVG path filling the host box — not a
  // CSS background, which only does rectangles. Handle it first and
  // return so the preset-fill/border path below never touches it.
  if (content.geometry === "custom" && content.path) {
    paintCustomPath(host, content.path, content.fill);
    return;
  }
  if (content.fill) host.style.background = content.fill;
  if (content.border) applyBorder(host, content.border);
  switch (content.geometry) {
    case "ellipse":
      host.style.borderRadius = "50%";
      break;
    case "roundedRect":
      // Word's preset corner radius is roughly 25% of the shorter
      // side. Without per-shape adjustment values we use a fixed
      // sensible default — matches the visual most "rounded rect"
      // decorations show.
      host.style.borderRadius = "8px";
      break;
    case "line":
      // A line is a 1-D shape. We render the border as a horizontal
      // rule centered vertically; for a vertical line the EMU dims
      // would naturally make it tall+thin so this still reads right.
      break;
    default:
      break;
  }
}

/**
 * Paint a custom-geometry outline. The path lives in its own
 * `widthEmu × heightEmu` box; an `<svg>` with that viewBox and
 * `preserveAspectRatio="none"` stretches it to fill the frame, so the
 * mark tracks the shape's size wherever the group scales it.
 * `fill-rule: evenodd` lets a glyph's counter (e.g. the hole in an "O")
 * read as a hole rather than a filled blob.
 */
function paintCustomPath(
  host: HTMLElement,
  path: NonNullable<Extract<AnchoredContent, { kind: "shape" }>["path"]>,
  fill: string | undefined,
): void {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${path.widthEmu} ${path.heightEmu}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.display = "block";
  const el = document.createElementNS(SVG_NS, "path");
  el.setAttribute("d", path.d);
  el.setAttribute("fill", fill ?? "currentColor");
  el.setAttribute("fill-rule", "evenodd");
  svg.appendChild(el);
  host.appendChild(svg);
}

function paintTextbox(
  host: HTMLElement,
  content: Extract<AnchoredContent, { kind: "textbox" }>,
  ctx: AnchorLayerContext,
): void {
  // The textbox FRAME (fill, border, padding) renders so the visual
  // chrome lands at the OOXML-declared coordinates.
  if (content.fill) host.style.background = content.fill;
  if (content.border) applyBorder(host, content.border);
  if (content.padding) {
    const p = content.padding;
    host.style.padding =
      `${emuToMm(p.topEmu)}mm ` +
      `${emuToMm(p.rightEmu)}mm ` +
      `${emuToMm(p.bottomEmu)}mm ` +
      `${emuToMm(p.leftEmu)}mm`;
  }
  // The textbox body is the anchor layer's text source. (The legacy
  // lifter that used to emit these paragraphs into body flow is gone;
  // `parseAnchoredFrames` claims the drawing so there's no double
  // render.) Use the injected `renderBody` (PaperStack wires in the
  // full `renderBlocks` pipeline); fall back to plain stacked text
  // when no renderer is supplied (headless / unit-test paths).
  if (ctx.renderBody) {
    ctx.renderBody(content.body, host);
  } else {
    for (const block of content.body) {
      if (block.kind !== "paragraph") continue;
      const p = document.createElement("p");
      p.style.margin = "0";
      p.textContent = block.runs.map((r) => (r.kind === "text" ? r.text : "")).join("");
      host.appendChild(p);
    }
  }
}

function paintGroup(
  host: HTMLElement,
  content: Extract<AnchoredContent, { kind: "group" }>,
  frameWidthEmu: number,
  frameHeightEmu: number,
  ctx: AnchorLayerContext,
): void {
  // Children's offsets are in the group's local coordinate system,
  // measured from its ORIGIN (`childCoordOffsetX/Y`, the `<a:chOff>`)
  // and spanning its EXTENT (`childCoordSystemCx/Cy`, the `<a:chExt>`).
  // The group is rendered at the frame's actual size (`frameWidthEmu/
  // HeightEmu`), so a child at local point P maps to
  // `(P − origin) × (size / extent)`: translate to the origin first,
  // then scale. Skipping the translate shifts every child by
  // `origin × scale` (the IOWA-letterhead displacement bug).
  const originX = content.childCoordOffsetX ?? 0;
  const originY = content.childCoordOffsetY ?? 0;
  const scaleX = content.childCoordSystemCx > 0 ? frameWidthEmu / content.childCoordSystemCx : 1;
  const scaleY = content.childCoordSystemCy > 0 ? frameHeightEmu / content.childCoordSystemCy : 1;
  for (const child of content.children) {
    const childEl = renderFrame(
      {
        ...child,
        offsetXEmu: (child.offsetXEmu - originX) * scaleX,
        offsetYEmu: (child.offsetYEmu - originY) * scaleY,
        widthEmu: child.widthEmu * scaleX,
        heightEmu: child.heightEmu * scaleY,
      },
      ctx,
    );
    host.appendChild(childEl);
  }
}

function applyBorder(
  host: HTMLElement,
  border: { color: string; widthEmu: number; style: "solid" | "dashed" | "dotted" | "double" },
): void {
  const widthPx = Math.max(1, Math.round(emuToPx(border.widthEmu)));
  host.style.border = `${widthPx}px ${border.style} ${border.color}`;
}

function resolvePictureUrl(partPath: string, ctx: AnchorLayerContext): string | null {
  const cached = ctx.pictureUrlCache.get(partPath);
  if (cached) return cached;
  const bytes = ctx.rawParts[partPath];
  if (!bytes) return null;
  const mime = mimeFromPath(partPath);
  const blob = new Blob([new Uint8Array(bytes)], { type: mime });
  const url = URL.createObjectURL(blob);
  ctx.pictureUrlCache.set(partPath, url);
  return url;
}

function mimeFromPath(path: string): string {
  const ext = path.toLowerCase().split(".").pop();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}
