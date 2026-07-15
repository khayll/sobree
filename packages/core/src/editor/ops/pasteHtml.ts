/**
 * Clipboard HTML → AST, for model-first rich paste (Phase 3-5 of
 * `devdocs/plan-model-first-editing.md`).
 *
 * The DOM→AST mapping is NOT reinvented here — `docSerialize` already owns it
 * (`blocksFromNodes` → paragraphs / headings / lists / tables via
 * `serializeInlineChildren`, which reads b/i/u/a/span[style]/… including
 * paste-from-Word wrappers). This module is the paste-specific ADAPTER over it:
 * foreign clipboard HTML nests blocks in wrapper `<div>`s and leaves loose
 * inline siblings between blocks, neither of which the flat read-back parser
 * groups. `flattenForPaste` normalises that into the flat block-element list
 * `blocksFromNodes` expects, then hands off.
 *
 * Output carries the `numbering` definitions the parsed lists allocated (numIds
 * local to the paste, starting at 1); the insertion step remaps them clear of
 * the target document's numbering.
 */

import type { Block, NumberingDefinition } from "../../doc/types";
import { type BlockSerializeContext, blocksFromNodes } from "../view/docSerialize/block";

/** Block tags `blocksFromNodes` maps directly — kept whole (not recursed). */
const MAPPED_BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "table",
  "blockquote",
  "hr",
  "pre",
]);

/** Generic containers that WRAP other blocks (Word/Google paste structure) —
 *  recurse into them when they hold block children, else treat as a paragraph. */
const GENERIC_CONTAINER_TAGS = new Set([
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "aside",
  "figure",
  "figcaption",
  "body",
  "dl",
  "dd",
  "dt",
]);

/** Parse a clipboard `text/html` string into AST blocks plus the numbering
 *  definitions its lists allocated. */
export function parseClipboardHtml(html: string): {
  blocks: Block[];
  numbering: NumberingDefinition[];
} {
  const dom = new DOMParser().parseFromString(html, "text/html");
  const flat = flattenForPaste(dom.body);
  const ctx: BlockSerializeContext = { numbering: [], currentList: null, sectionBreaks: 0 };
  const blocks = blocksFromNodes(flat, ctx);
  return { blocks, numbering: ctx.numbering };
}

/**
 * Flatten `container`'s subtree into the flat block-element list
 * `blocksFromNodes` consumes: mapped block elements pass through, wrapper
 * containers recurse, and runs of loose inline siblings (text, `<span>`,
 * `<b>`, `<a>`, `<br>`, …) are grouped into a synthetic `<p>` so they become
 * one paragraph instead of one-per-node.
 */
function flattenForPaste(container: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  let inlineBuffer: Node[] = [];

  const flushInline = (): void => {
    const meaningful = inlineBuffer.some(
      (n) =>
        (n.textContent ?? "").trim() !== "" ||
        (n instanceof HTMLElement && (n.tagName === "BR" || n.tagName === "IMG")),
    );
    if (meaningful) {
      const p = container.ownerDocument.createElement("p");
      for (const n of inlineBuffer) p.appendChild(n.cloneNode(true));
      out.push(p);
    }
    inlineBuffer = [];
  };

  for (const node of Array.from(container.childNodes)) {
    if (node instanceof HTMLElement) {
      const tag = node.tagName.toLowerCase();
      if (MAPPED_BLOCK_TAGS.has(tag)) {
        flushInline();
        out.push(node);
        continue;
      }
      if (GENERIC_CONTAINER_TAGS.has(tag)) {
        flushInline();
        // A wrapper holding blocks recurses; a wrapper of only inline content is
        // handed to `blocksFromNodes` whole (it maps an unknown block to one
        // paragraph via `serializeInlineChildren`).
        if (hasBlockChild(node)) out.push(...flattenForPaste(node));
        else out.push(node);
        continue;
      }
      // Inline element — buffer it into the current paragraph.
      inlineBuffer.push(node);
    } else if (node.nodeType === Node.TEXT_NODE) {
      inlineBuffer.push(node);
    }
  }
  flushInline();
  return out;
}

/** Whether `el` has a child that is itself a block (so `el` is a wrapper to
 *  recurse into, not a paragraph). */
function hasBlockChild(el: HTMLElement): boolean {
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase();
    if (MAPPED_BLOCK_TAGS.has(tag) || GENERIC_CONTAINER_TAGS.has(tag)) return true;
  }
  return false;
}
