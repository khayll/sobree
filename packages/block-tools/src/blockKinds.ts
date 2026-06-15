/**
 * Block-kind identification + per-kind metadata for the block indicator
 * and toolbar. Inline Lucide SVG (2px stroke) matches the design system;
 * icons are monochrome via `currentColor` so they inherit the indicator
 * state colour.
 */

export type BlockKind =
  | "paragraph"
  | "heading"
  | "list"
  | "listOrdered"
  | "blockquote"
  | "table"
  | "image"
  | "header"
  | "footer"
  | "sectionBreak";

export interface BlockKindInfo {
  kind: BlockKind;
  /** Short label shown in tooltips and the toolbar header. */
  label: string;
  /** Inline SVG body — `<svg>` wrapper is added by the indicator. */
  iconPath: string;
}

const SVG_PARAGRAPH = `<path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/>`;
const SVG_HEADING = `<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/>`;
const SVG_LIST = `<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>`;
const SVG_LIST_ORDERED = `<path d="M10 12h11"/><path d="M10 18h11"/><path d="M10 6h11"/><path d="M4 10h2"/><path d="M4 6h1v4"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>`;
const SVG_QUOTE = `<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>`;
const SVG_TABLE = `<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>`;
const SVG_IMAGE = `<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>`;
const SVG_CHEVRON_UP = `<path d="m18 15-6-6-6 6"/>`;
const SVG_CHEVRON_DOWN = `<path d="m6 9 6 6 6-6"/>`;
// Lucide "separator-horizontal".
const SVG_SECTION_BREAK = `<path d="M3 12h18"/><path d="m8 8 4-4 4 4"/><path d="m16 16-4 4-4-4"/>`;

export const BLOCK_KINDS: Record<BlockKind, BlockKindInfo> = {
  paragraph: { kind: "paragraph", label: "Paragraph", iconPath: SVG_PARAGRAPH },
  heading: { kind: "heading", label: "Heading", iconPath: SVG_HEADING },
  list: { kind: "list", label: "Bullet list", iconPath: SVG_LIST },
  listOrdered: { kind: "listOrdered", label: "Numbered list", iconPath: SVG_LIST_ORDERED },
  blockquote: { kind: "blockquote", label: "Quote", iconPath: SVG_QUOTE },
  table: { kind: "table", label: "Table", iconPath: SVG_TABLE },
  image: { kind: "image", label: "Image", iconPath: SVG_IMAGE },
  header: { kind: "header", label: "Header", iconPath: SVG_CHEVRON_UP },
  footer: { kind: "footer", label: "Footer", iconPath: SVG_CHEVRON_DOWN },
  sectionBreak: { kind: "sectionBreak", label: "Section break", iconPath: SVG_SECTION_BREAK },
};

export function iconSvg(info: BlockKindInfo): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${info.iconPath}</svg>`;
}

/** A tracked block target for indicator / toolbar positioning. */
export interface BlockTarget {
  kind: BlockKind;
  /** DOM element representing the block — used for positioning. */
  element: HTMLElement;
  /** Enclosing `.paper` element. */
  paper: HTMLElement;
  /**
   * Stable block id (registry) if available — stamped by the renderer as
   * `data-block-id`. Lets the toolbar re-resolve the DOM element after
   * a commit rebuilds the body (header/footer zones have no id).
   */
  blockId?: string;
}

/**
 * Walk from a DOM node up to find its containing block inside the
 * paper stack. Returns `null` if the node is outside the stack.
 */
export function blockTargetFrom(node: Node, stackRoot: HTMLElement): BlockTarget | null {
  if (!stackRoot.contains(node)) return null;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
  if (!el) return null;

  const paper = el.closest(".paper") as HTMLElement | null;
  if (!paper) return null;

  const header = el.closest(".paper-header") as HTMLElement | null;
  if (header && paper.contains(header)) return { kind: "header", element: header, paper };

  const footer = el.closest(".paper-footer") as HTMLElement | null;
  if (footer && paper.contains(footer)) return { kind: "footer", element: footer, paper };

  const image = el.closest("img") as HTMLElement | null;
  if (image && paper.contains(image)) {
    // Walk up to the enclosing block element to keep the indicator at
    // block-left rather than image-left.
    const host = image.closest("p, h1, h2, h3, h4, h5, h6, li, blockquote") as HTMLElement | null;
    if (host) return withBlockId({ kind: "image", element: host, paper });
  }

  const sectionBreak = el.closest(".sobree-section-break") as HTMLElement | null;
  if (sectionBreak && paper.contains(sectionBreak)) {
    return withBlockId({ kind: "sectionBreak", element: sectionBreak, paper });
  }

  const table = el.closest("table") as HTMLElement | null;
  if (table && paper.contains(table)) return withBlockId({ kind: "table", element: table, paper });

  const heading = el.closest("h1, h2, h3, h4, h5, h6") as HTMLElement | null;
  if (heading && paper.contains(heading))
    return withBlockId({ kind: "heading", element: heading, paper });

  const bq = el.closest("blockquote") as HTMLElement | null;
  if (bq && paper.contains(bq)) return withBlockId({ kind: "blockquote", element: bq, paper });

  const li = el.closest("li") as HTMLElement | null;
  if (li && paper.contains(li)) {
    const parent = li.parentElement;
    const kind: BlockKind = parent?.tagName.toLowerCase() === "ol" ? "listOrdered" : "list";
    return withBlockId({ kind, element: li, paper });
  }

  const p = el.closest("p") as HTMLElement | null;
  if (p && paper.contains(p)) return withBlockId({ kind: "paragraph", element: p, paper });

  return null;
}

function withBlockId(t: BlockTarget): BlockTarget {
  const id = t.element.dataset.blockId;
  if (id) t.blockId = id;
  return t;
}

/** Same lookup by arbitrary `Node` (handles TEXT_NODE). */
export function blockTargetFromNode(node: Node | null, stackRoot: HTMLElement): BlockTarget | null {
  if (!node) return null;
  return blockTargetFrom(node, stackRoot);
}
