import { defaultStyles } from "../../../doc/builders";
import type { SobreeDocument } from "../../../doc/types";
import { type BlockSerializeContext, blocksFromNodes } from "./block";

/**
 * Serialise DOM content across one or more host elements (in document
 * order) into a SobreeDocument. Sections / headers / footers are NOT
 * produced here — the Sobree façade injects those from its current page
 * setup state before handing the document off to the exporter.
 */
export interface SerializeHostsOptions {
  /**
   * Capture each paragraph's effective base run style into
   * `ParagraphProperties.runDefaults`. Set for textbox-frame read-back so a
   * frame's font survives run-level styling loss; left off for body flow,
   * which stays style-linked. See `BlockSerializeContext.captureRunDefaults`.
   */
  captureRunDefaults?: boolean;
}

export function serializeHostsToDocument(
  hosts: readonly HTMLElement[],
  options: SerializeHostsOptions = {},
): SobreeDocument {
  const ctx: BlockSerializeContext = {
    numbering: [],
    currentList: null,
    captureRunDefaults: options.captureRunDefaults ?? false,
  };
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
