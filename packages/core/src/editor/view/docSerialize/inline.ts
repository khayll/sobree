import { modelHrefFrom } from "../../../doc/bookmarks";
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

  // First-class read-back for renderer-emitted data spans — BEFORE the
  // tag switch, since they are all `<span>`s. Without these, a field's
  // cached text degrades to a plain run and bookmark markers vanish on
  // the DOM read-back path (the gap noted when markers landed).
  if (node.dataset.field !== undefined) {
    const field: InlineRun = { kind: "field", instruction: node.dataset.field };
    const cached = node.textContent ?? "";
    out.push(cached !== "" ? { ...field, cached } : field);
    return;
  }
  if (node.dataset.bookmarkStart !== undefined) {
    const id = Number(node.dataset.bookmarkStart);
    const name = node.dataset.name ?? "";
    if (Number.isFinite(id) && name !== "") out.push({ kind: "bookmarkStart", id, name });
    return;
  }
  if (node.dataset.bookmarkEnd !== undefined) {
    const id = Number(node.dataset.bookmarkEnd);
    if (Number.isFinite(id)) out.push({ kind: "bookmarkEnd", id });
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
      const href = modelHrefFrom(node.getAttribute("href") ?? "");
      const children: InlineRun[] = [];
      const linkProps = withStyle(node, inherited, {});
      for (const child of Array.from(node.childNodes)) walk(child, linkProps, children);
      const link: HyperlinkRun = { kind: "hyperlink", href, children };
      out.push(link);
      return;
    }
    case "strong":
    case "b":
      descend(node, withStyle(node, inherited, { bold: true }), out);
      return;
    case "em":
    case "i":
      descend(node, withStyle(node, inherited, { italic: true }), out);
      return;
    case "u":
    case "ins":
      descend(node, withStyle(node, inherited, { underline: "single" }), out);
      return;
    case "s":
    case "del":
    case "strike":
      descend(node, withStyle(node, inherited, { strike: true }), out);
      return;
    case "sup":
      descend(node, withStyle(node, inherited, { verticalAlign: "superscript" }), out);
      return;
    case "sub":
      descend(node, withStyle(node, inherited, { verticalAlign: "subscript" }), out);
      return;
    case "mark":
      descend(node, withStyle(node, inherited, { highlight: "yellow" }), out);
      return;
    case "code":
      descend(node, withStyle(node, inherited, { fontFamily: "Consolas" }), out);
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

/**
 * Run properties for a semantic inline element: the tag's own mark (bold /
 * italic / …) layered over `inherited`, then the element's own inline `style`
 * merged ON TOP so an explicit declaration wins.
 *
 * Load-bearing for PASTE: foreign clipboard HTML inlines computed styles onto
 * whichever element it copied — for text inside a `<strong>`, that's the
 * `<strong>` itself — so reading only the tag's mark and ignoring its `style`
 * silently drops colour / small-caps / size (a copied orange small-caps word
 * pasted back as plain bold). Sobree's own render never puts a `style` on a
 * semantic tag, so this is a no-op for the read-back path.
 */
function withStyle(el: HTMLElement, inherited: RunProperties, mark: RunProperties): RunProperties {
  return mergeStyleAttribute({ ...inherited, ...mark }, el.getAttribute("style"));
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

export function mergeStyleAttribute(base: RunProperties, styleAttr: string | null): RunProperties {
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
      // Take the FIRST family, THEN strip quotes. The renderer emits a
      // fallback chain (`'Myriad Pro Cond', 'Arial Narrow', …`); stripping
      // before the split left a stray quote on the first name
      // (`Myriad Pro Cond'`), which then failed to round-trip.
      out.fontFamily =
        val
          .split(",")[0]
          ?.trim()
          .replace(/^['"]|['"]$/g, "")
          .trim() || val;
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
      // `line-through double` is doubleStrike; plain `line-through` is strike.
      if (val.includes("line-through")) {
        if (val.includes("double")) out.doubleStrike = true;
        else out.strike = true;
      }
    } else if (key === "text-transform") {
      if (val === "uppercase") out.caps = true;
    } else if (key === "font-variant-caps" || key === "font-variant") {
      if (val.includes("small-caps")) out.smallCaps = true;
    }
  }
  return out;
}
