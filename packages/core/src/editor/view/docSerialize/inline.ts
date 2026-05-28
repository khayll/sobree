import type { HyperlinkRun, InlineRun, RunProperties } from "../../../doc/types";

/**
 * Serialise DOM children of `el` into a flat `InlineRun[]`. Nested
 * formatting wrappers (`<strong><em>...`) are flattened — each leaf text
 * node yields one `TextRun` whose `RunProperties` is the union of all
 * formatting seen on the path from `el` to that text node.
 *
 * `<a>` elements produce a `HyperlinkRun` wrapping recursively-serialised
 * children (their own flat run list).
 */
export function serializeInlineChildren(el: HTMLElement): InlineRun[] {
  const out: InlineRun[] = [];
  for (const node of Array.from(el.childNodes)) walk(node, {}, out);
  return out;
}

function walk(node: Node, inherited: RunProperties, out: InlineRun[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (text === "") return;
    out.push({ kind: "text", text, properties: { ...inherited } });
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  if (node.getAttribute("contenteditable") === "false") {
    // Skip editor chrome (e.g. table tool bar, page-break markers that
    // re-emerge as synthetic runs in their own right).
    if (node.hasAttribute("data-page-break") || node.dataset.pageBreak !== undefined) {
      out.push({ kind: "break", type: "page" });
    }
    return;
  }

  const tag = node.tagName.toLowerCase();

  switch (tag) {
    case "br":
      out.push({ kind: "break", type: "line" });
      return;
    case "img": {
      const alt = node.getAttribute("alt") ?? "";
      const widthPx = readPxDimension(node.style.width, node.getAttribute("width"));
      const heightPx = readPxDimension(node.style.height, node.getAttribute("height"));
      const drawing: import("../../../doc/types").DrawingRun = {
        kind: "drawing",
        partPath: node.dataset.part ?? "",
        widthEmu: widthPx > 0 ? Math.round((widthPx / 96) * 914400) : 0,
        heightEmu: heightPx > 0 ? Math.round((heightPx / 96) * 914400) : 0,
        placement: "inline",
      };
      if (alt) drawing.altText = alt;
      out.push(drawing);
      return;
    }
    case "a": {
      const href = node.getAttribute("href") ?? "";
      const children: InlineRun[] = [];
      for (const child of Array.from(node.childNodes)) walk(child, inherited, children);
      const link: HyperlinkRun = { kind: "hyperlink", href, children };
      out.push(link);
      return;
    }
    case "strong":
    case "b":
      descend(node, { ...inherited, bold: true }, out);
      return;
    case "em":
    case "i":
      descend(node, { ...inherited, italic: true }, out);
      return;
    case "u":
    case "ins":
      descend(node, { ...inherited, underline: "single" }, out);
      return;
    case "s":
    case "del":
    case "strike":
      descend(node, { ...inherited, strike: true }, out);
      return;
    case "sup":
      descend(node, { ...inherited, verticalAlign: "superscript" }, out);
      return;
    case "sub":
      descend(node, { ...inherited, verticalAlign: "subscript" }, out);
      return;
    case "mark":
      descend(node, { ...inherited, highlight: "yellow" }, out);
      return;
    case "code":
      descend(node, { ...inherited, fontFamily: "Consolas" }, out);
      return;
    case "span": {
      const merged = mergeStyleAttribute(inherited, node.getAttribute("style"));
      descend(node, merged, out);
      return;
    }
    default:
      // Unknown wrapper — treat as a transparent span so styling attrs
      // still flow through. This keeps user-added wrappers (e.g. from
      // paste-from-Word) from silently dropping content.
      descend(node, mergeStyleAttribute(inherited, node.getAttribute("style")), out);
      return;
  }
}

function descend(el: HTMLElement, inherited: RunProperties, out: InlineRun[]): void {
  for (const child of Array.from(el.childNodes)) walk(child, inherited, out);
}

/**
 * Parse an inline `style` attribute's CSS declarations and fold the
 * recognised keys into a `RunProperties`. Unknown declarations drop.
 */
/**
 * Resolve a dimension to CSS pixels, honoring the `style` value first
 * and falling back to a legacy `width`/`height` attribute. Returns 0
 * when neither is parseable.
 */
function readPxDimension(styleValue: string, attrValue: string | null): number {
  const style = styleValue.trim();
  if (style) {
    const m = style.match(/^([\d.]+)\s*(px)?$/i);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  if (attrValue) {
    const n = Number(attrValue);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function mergeStyleAttribute(
  base: RunProperties,
  styleAttr: string | null,
): RunProperties {
  if (!styleAttr) return base;
  const out: RunProperties = { ...base };
  for (const decl of styleAttr.split(";")) {
    const [rawKey, rawVal] = decl.split(":");
    if (!rawKey || !rawVal) continue;
    const key = rawKey.trim().toLowerCase();
    const val = rawVal.trim();
    if (!val) continue;
    if (key === "color") out.color = val;
    else if (key === "background" || key === "background-color") out.highlight = val;
    else if (key === "font-family") {
      out.fontFamily =
        val.replace(/^['"]|['"]$/g, "").split(",")[0]?.trim() || val;
    } else if (key === "font-size") {
      const m = val.match(/^([\d.]+)(pt|px)?$/);
      if (m?.[1]) {
        const n = Number(m[1]);
        const pt = m[2] === "px" ? n * 0.75 : n;
        if (Number.isFinite(pt) && pt > 0) out.fontSizePt = pt;
      }
    } else if (key === "font-weight") {
      if (val === "bold" || Number(val) >= 600) out.bold = true;
    } else if (key === "font-style") {
      if (val === "italic") out.italic = true;
    } else if (key === "text-decoration") {
      if (val.includes("underline")) out.underline = "single";
      if (val.includes("line-through")) out.strike = true;
    }
  }
  return out;
}
