import { NS } from "./namespaces";

/**
 * Thin wrappers around the browser's `DOMParser` and `XMLSerializer`.
 * Pure functions; keep anything stateful (caches, registries) out of this
 * file. One helper per concern so call sites stay readable.
 */

export function parseXml(src: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(src, "application/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new Error(`XML parse failed: ${err.textContent?.slice(0, 200) ?? ""}`);
  return doc;
}

export function serializeXml(node: Node): string {
  return new XMLSerializer().serializeToString(node);
}

/** Get the first descendant element in the WordprocessingML namespace. */
export function wFirst(root: Document | Element, localName: string): Element | null {
  return root.getElementsByTagNameNS(NS.w, localName)[0] ?? null;
}

/** Get all descendants in the WordprocessingML namespace. */
export function wAll(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS(NS.w, localName));
}

/** Get direct-child elements in the WordprocessingML namespace. */
export function wChildren(parent: Element, localName: string): Element[] {
  const out: Element[] = [];
  for (const child of Array.from(parent.children)) {
    if (child.namespaceURI === NS.w && child.localName === localName) out.push(child);
  }
  return out;
}

/**
 * Read a `w:val` attribute, Word's standard way of carrying a single value.
 * Accepts either namespaced or non-namespaced attribute lookup since
 * serialised documents differ.
 */
export function wVal(el: Element | null): string | null {
  if (!el) return null;
  return el.getAttributeNS(NS.w, "val") ?? el.getAttribute("w:val");
}

/**
 * Read an OOXML on/off toggle property (`CT_OnOff`: `<w:pageBreakBefore>`,
 * `<w:b>`, `<w:keepNext>`, …). Absent → false. Present with no `w:val` →
 * true (a bare element means "on"). Present with `w:val` →
 * "false"/"0"/"off" mean OFF; anything else ON.
 *
 * Reading these by mere presence is a classic OOXML bug: Word writes the
 * explicit-off form (`<w:pageBreakBefore w:val="0"/>`) in DocDefaults and
 * styles, so presence-only flips the property ON for every consumer — e.g.
 * a page break before every paragraph.
 */
export function wOnOff(root: Document | Element, localName: string): boolean {
  const el = wFirst(root, localName);
  if (!el) return false;
  const val = wVal(el);
  if (val === null) return true;
  return val !== "false" && val !== "0" && val !== "off";
}

/**
 * TRI-STATE read of an OOXML toggle property (`CT_OnOff`: `<w:b>`,
 * `<w:caps>`, …) from an already-resolved element. Unlike {@link wOnOff}
 * this distinguishes "absent" from "explicit-off":
 *   - element absent (`null`)             → `undefined` (inherit);
 *   - present, no `w:val` (bare `<w:b/>`) → `true`;
 *   - `w:val` "0" / "false"               → `false` (explicit off).
 *
 * The `false` is load-bearing at BOTH `<w:rPr>` sites: a direct run's
 * `<w:caps w:val="0"/>` overrides an inherited toggle, and a style's
 * explicit-off resets it as the cascade combines (`mergeRunStyleLayer`).
 * Toggle XOR-combination across the style hierarchy is the resolver's job
 * (doc/styles.ts), not the reader's — this only records the raw value.
 */
export function wToggleOn(el: Element | null): boolean | undefined {
  if (!el) return undefined;
  const val = wVal(el);
  if (val === null) return true;
  return val !== "false" && val !== "0";
}

/** Build an XML declaration header + root element. Used by the exporter. */
export function xmlDocument(rootXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${rootXml}`;
}

/**
 * Emit a single element as a string. Attributes are rendered in insertion
 * order; children are pre-serialized strings. Prefers a tiny, composable
 * string builder over a virtual DOM — the OOXML shapes we emit are flat
 * enough that this is clearer than juggling `document.createElementNS`.
 */
export function el(
  tag: string,
  attrs: Record<string, string | number | undefined> | null = null,
  children: string[] | string | null = null,
): string {
  const a = attrs
    ? Object.entries(attrs)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
        .join("")
    : "";
  if (children === null || (Array.isArray(children) && children.length === 0)) {
    return `<${tag}${a}/>`;
  }
  const body = Array.isArray(children) ? children.join("") : children;
  return `<${tag}${a}>${body}</${tag}>`;
}

export function escapeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
