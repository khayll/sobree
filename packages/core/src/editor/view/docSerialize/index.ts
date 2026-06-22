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
  return serializeHostsWithSources(hosts, options).document;
}

/**
 * Like {@link serializeHostsToDocument}, but also returns each block's
 * source DOM element (parallel to `document.body`, `null` for bare text
 * nodes). The editor reads each element's stable `data-block-id` to match a
 * re-read block back to its previous AST block — so block-level properties
 * the contentEditable DOM can't carry survive the read-back across plain
 * typing AND structural edits (Enter / Backspace / paste / reorder).
 */
export function serializeHostsWithSources(
  hosts: readonly HTMLElement[],
  options: SerializeHostsOptions = {},
): { document: SobreeDocument; sources: (HTMLElement | null)[] } {
  const sources: (HTMLElement | null)[] = [];
  const ctx: BlockSerializeContext = {
    numbering: [],
    currentList: null,
    sectionBreaks: 0,
    captureRunDefaults: options.captureRunDefaults ?? false,
    sources,
  };
  const body = [];
  for (const host of hosts) {
    body.push(...blocksFromNodes(Array.from(host.childNodes), ctx));
  }
  return {
    document: {
      body,
      sections: [],
      headerFooterBodies: {},
      styles: defaultStyles(),
      numbering: ctx.numbering,
      rawParts: {},
      fonts: [],
    },
    sources,
  };
}
