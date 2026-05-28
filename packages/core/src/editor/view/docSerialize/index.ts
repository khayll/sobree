import { type BlockSerializeContext, blocksFromNodes } from "./block";
import { defaultStyles } from "../../../doc/builders";
import type { SobreeDocument } from "../../../doc/types";

/**
 * Serialise DOM content across one or more host elements (in document
 * order) into a SobreeDocument. Sections / headers / footers are NOT
 * produced here — the Sobree façade injects those from its current page
 * setup state before handing the document off to the exporter.
 */
export function serializeHostsToDocument(hosts: readonly HTMLElement[]): SobreeDocument {
  const ctx: BlockSerializeContext = { numbering: [], currentList: null };
  const body = [];
  for (const host of hosts) {
    body.push(...blocksFromNodes(Array.from(host.childNodes), ctx));
  }
  return {
    body,
    sections: [],
    headerFooterBodies: {},
    styles: defaultStyles(),
    numbering: ctx.numbering,
    rawParts: {},
    fonts: [],
  };
}
