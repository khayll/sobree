/**
 * Parse `word/footnotes.xml` into a map of `id → Block[]`.
 *
 * OOXML structure:
 *
 *   <w:footnotes>
 *     <w:footnote w:type="separator" w:id="-1">...</w:footnote>
 *     <w:footnote w:type="continuationSeparator" w:id="0">...</w:footnote>
 *     <w:footnote w:id="1"><w:p>...body...</w:p></w:footnote>
 *     <w:footnote w:id="2">...</w:footnote>
 *   </w:footnotes>
 *
 * The `separator` and `continuationSeparator` footnotes are visual
 * artefacts (the horizontal rule between body and footnote area, and
 * its continuation marker). We skip them — they're a paginator
 * concern. Negative ids are also skipped (Word's reserved range).
 */

import type { Block } from "../../doc/types";
import { NS } from "../shared/namespaces";
import { parseXml, wAll } from "../shared/xml";
import { type ConvertContext, convertParagraph } from "./paragraph";
import { convertTable } from "./tables";

export function parseFootnotesXml(
  xml: string | undefined,
  ctx: ConvertContext,
): Record<number, Block[]> {
  if (!xml) return {};
  let doc: Document;
  try {
    doc = parseXml(xml);
  } catch {
    return {};
  }
  const out: Record<number, Block[]> = {};
  for (const footnote of wAll(doc, "footnote")) {
    const typeAttr = footnote.getAttributeNS(NS.w, "type") ?? footnote.getAttribute("w:type");
    if (typeAttr === "separator" || typeAttr === "continuationSeparator") continue;
    const idAttr = footnote.getAttributeNS(NS.w, "id") ?? footnote.getAttribute("w:id");
    const id = Number(idAttr);
    if (!Number.isFinite(id) || id < 1) continue;

    const blocks: Block[] = [];
    for (const child of Array.from(footnote.children)) {
      if (child.namespaceURI !== NS.w) continue;
      if (child.localName === "p") blocks.push(convertParagraph(child, ctx));
      else if (child.localName === "tbl") blocks.push(convertTable(child, ctx));
      // Other element types silently dropped — footnote bodies are
      // almost always plain paragraphs.
    }
    out[id] = blocks;
  }
  return out;
}
