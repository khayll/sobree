import { serializeInlineChildren } from "./inline";
import { tableFromElement } from "./table";
import type { Block, NumberingDefinition, Paragraph, ParagraphProperties } from "../../../doc/types";

export interface BlockSerializeContext {
  /** Accumulated numbering definitions, one per encountered list. */
  numbering: NumberingDefinition[];
  /**
   * Allocated numId for the CURRENT list stream. Reset to `null` by the
   * caller between lists.
   */
  currentList: { numId: number; ordered: boolean } | null;
}

export function blocksFromNodes(
  nodes: readonly Node[],
  ctx: BlockSerializeContext,
): Block[] {
  const out: Block[] = [];
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text.trim() === "") continue;
      out.push({
        kind: "paragraph",
        properties: {},
        runs: [{ kind: "text", text, properties: {} }],
      });
      continue;
    }
    if (!(node instanceof HTMLElement)) continue;

    // Section break — recognise the renderer's marker class and emit a
    // real `SectionBreak` block. Must come BEFORE the
    // `contenteditable="false"` skip below, since the marker is also
    // contenteditable=false but carries semantic meaning.
    if (node.classList.contains("sobree-section-break")) {
      out.push({ kind: "section_break", toSectionIndex: 0 });
      ctx.currentList = null;
      continue;
    }

    if (node.getAttribute("contenteditable") === "false") continue;

    const tag = node.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") {
      // Allocate a fresh numId for this list's run.
      const numId = ctx.numbering.length + 1;
      const ordered = tag === "ol";
      ctx.numbering.push({
        numId,
        abstractFormat: {
          levels: [
            { level: 0, format: ordered ? "decimal" : "bullet", text: ordered ? "%1." : "\u2022" },
          ],
        },
      });
      for (const li of Array.from(node.querySelectorAll(":scope > li"))) {
        if (!(li instanceof HTMLElement)) continue;
        const paragraph: Paragraph = {
          kind: "paragraph",
          properties: { numbering: { numId, level: 0 } },
          runs: serializeInlineChildren(li),
        };
        out.push(paragraph);
      }
      ctx.currentList = null;
      continue;
    }

    ctx.currentList = null;

    if (tag === "table") {
      out.push(tableFromElement(node));
      continue;
    }

    if (tag === "hr" || node.hasAttribute("data-page-break")) {
      out.push({
        kind: "paragraph",
        properties: {
          borders: {
            bottom: { style: "single", sizeEighthsOfPt: 6, color: "auto", spaceTwips: 1 },
          },
        },
        runs: [],
      });
      continue;
    }

    if (tag === "blockquote") {
      // Render each inner paragraph as a Quote-styled paragraph.
      for (const child of Array.from(node.children)) {
        if (!(child instanceof HTMLElement)) continue;
        const para = paragraphFromElement(child, "Quote");
        if (para) out.push(para);
      }
      continue;
    }

    const para = paragraphFromElement(node);
    if (para) out.push(para);
  }
  return out;
}

function paragraphFromElement(
  el: HTMLElement,
  forcedStyleId?: string,
): Paragraph | null {
  const tag = el.tagName.toLowerCase();
  const properties: ParagraphProperties = {};

  if (forcedStyleId) {
    properties.styleId = forcedStyleId;
  } else {
    const m = tag.match(/^h([1-6])$/);
    if (m) properties.styleId = `Heading${m[1]}`;
  }

  const align = el.style.textAlign;
  if (align === "left" || align === "right" || align === "center") {
    properties.alignment = align;
  } else if (align === "justify") {
    properties.alignment = "both";
  }

  const lineHeight = el.style.lineHeight;
  if (lineHeight) {
    const n = Number(lineHeight);
    if (Number.isFinite(n) && n > 0) {
      properties.spacing = { line: Math.round(240 * n), lineRule: "auto" };
    }
  }

  // Style classes like `.style-quote` feed back into Word style ids.
  const classStyle = Array.from(el.classList).find((c) => c.startsWith("style-"));
  if (classStyle && !properties.styleId) {
    const id = capitalise(classStyle.slice(6));
    properties.styleId = id;
  }

  return {
    kind: "paragraph",
    properties,
    runs: serializeInlineChildren(el),
  };
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
