import type { Block } from "../../doc/types";
import { wFirst } from "../shared/xml";
import { type ConvertContext, convertParagraph } from "./paragraph";
import { convertTable } from "./tables";

// Re-export so existing callers (and the import barrel) keep their
// `import { ConvertContext, convertParagraph } from "./document"` paths.
// New code should import from `./paragraph` directly.
export { type ConvertContext, convertParagraph } from "./paragraph";

export interface DocumentImport {
  body: Block[];
  warnings: string[];
  /**
   * `<w:sectPr>` elements collected in document order, for the import
   * pipeline to convert into `SectionProperties[]`. Includes both
   * inline (paragraph-pPr) and body-level sectPrs.
   *
   * Length equals the number of sections in the resulting document.
   * Inline sectPrs end non-final sections; the body-level one (always
   * last) is the document-final section.
   */
  sectPrEls: Element[];
}

/**
 * Convert a parsed `word/document.xml` into the SobreeDocument body — a
 * flat list of `Block`s (Paragraphs, Tables, SectionBreaks).
 *
 * Multi-section detection: any paragraph whose `<w:pPr>` carries an
 * inline `<w:sectPr>` is the last paragraph of a non-final section.
 * The walker emits a `SectionBreak` block immediately after such a
 * paragraph, and stashes the sectPr Element for the import pipeline
 * to convert into `SectionProperties`. The body-level `<w:sectPr>` is
 * stashed last as the document-final section's properties.
 */
/**
 * Optional per-paragraph block replacements. When the body walker
 * encounters a `<w:p>` element that's a key in `replaceParagraphs`,
 * it emits the mapped Block *instead of* calling `convertParagraph`
 * on it (and does NOT consume the paragraph's text content as a
 * Paragraph block).
 *
 * Used by the `InlineFrame` import path to swap out section-heading
 * paragraphs for first-class `InlineFrame` blocks at their original
 * document-order position — without resorting to DOM-attribute
 * markers or a post-walk splice. The contract is a typed map; the
 * caller owns key identity.
 */
export interface ConvertOptions {
  replaceParagraphs?: Map<Element, Block>;
  /** Whether the document carries inline-frame groups (section textbox
   *  pills, `<wp:inline>` drawing groups). These are the layouts whose
   *  frame heights our paginator estimates imperfectly, so for them we
   *  fall back to honouring Word's `<w:lastRenderedPageBreak/>` hints.
   *  A plain text-flow document paginates accurately on its own and must
   *  IGNORE the hints (ECMA-376's guidance), or stale hints fragment its
   *  pages. Set by the importer from the parsed inline-frame count. */
  hasComplexFrames?: boolean;
}

export function convertDocumentXml(
  xmlDoc: Document,
  ctx: ConvertContext,
  opts?: ConvertOptions,
): DocumentImport {
  const body = wFirst(xmlDoc, "body");
  if (!body) return { body: [], warnings: ["document.xml has no <w:body>"], sectPrEls: [] };
  // `<w:lastRenderedPageBreak/>` is a HINT Word writes during save
  // — a record of where Word's layout engine broke pages last time.
  // ECMA-376 says consumers SHOULD ignore it for layout, and a
  // re-paginating editor normally must: the hints are stale the moment
  // our line metrics differ from Word's.
  //
  // The one exception is frame-heavy documents (complex-multipage's 32
  // inline-frame section pills): our paginator estimates those frame
  // heights imperfectly, so without the hints it packs pages 3-into-1
  // and per-element y positions drift 300-400pt vs LO. There, honouring
  // a STRONG hint signal (≥10 markers) restores Word's page layout.
  //
  // For a plain text-flow document (no inline frames) we paginate
  // accurately on our own, so honouring stale hints only FRAGMENTS the
  // result — the ACM submission template (12 hints, zero frames) blew
  // up from 13 pages to 17, each forced break stranding a half-empty
  // page. So gate honouring on BOTH a strong hint count AND the presence
  // of the frames that make our own pagination unreliable.
  const hintCount = body.getElementsByTagNameNS(
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "lastRenderedPageBreak",
  ).length;
  const enrichedCtx: ConvertContext = {
    ...ctx,
    honorLastRenderedPageBreaks: hintCount >= 10 && opts?.hasComplexFrames === true,
    // Fold the replacement map into the CONTEXT (not just the body
    // walker's opts) — host paragraphs can live inside table cells,
    // whose walker only sees ctx. Without this, a drawing claimed from
    // a cell paragraph leaves an empty husk and the frame vanishes.
    ...(opts?.replaceParagraphs ? { replaceParagraphs: opts.replaceParagraphs } : {}),
  };
  return convertBlocksFromContainer(body, enrichedCtx, opts);
}

/**
 * Walk a container element (`<w:body>` for `document.xml`, `<w:hdr>` /
 * `<w:ftr>` for header/footer parts) and turn its direct paragraph +
 * table children into `Block[]`. Extracted from `convertDocumentXml`
 * so header/footer parts get the same rich-content import — drawings,
 * comment ranges, revisions, formatted runs — instead of being
 * collapsed to flat text by `flattenZone`.
 *
 * Header / footer parts never carry inline `<w:sectPr>` elements, so
 * for those the returned `sectPrEls` is always empty.
 */
export function convertBlocksFromContainer(
  container: Element,
  ctx: ConvertContext,
  opts?: ConvertOptions,
): DocumentImport {
  const warnings: string[] = [];
  const blocks: Block[] = [];
  const sectPrEls: Element[] = [];
  let pendingSectionIndex = 0;
  // One shared active-comments set across the whole walk. A comment
  // whose `<w:commentRangeStart>` opens in para N and
  // `<w:commentRangeEnd>` closes in para M>N keeps the intermediate
  // paragraphs' runs tagged. Tables build their own fresh sets
  // (inside `convertTable`) so a body-level range doesn't leak into
  // an unrelated cell.
  const activeComments = new Set<number>();

  // Flatten any `<w:sdt>` wrappers (Structured Document Tags / content
  // controls) into the host's direct child list. Word uses SDTs to
  // wrap repeating sections, gallery placeholders, dropdowns, and
  // template-named blocks (e.g. "Resume Name"). Their visual
  // semantics are identical to the wrapped content for rendering;
  // they only matter when the user interacts with them as a form
  // control. Without flattening, the importer silently dropped
  // everything inside — observed on healthcare-with-photo.docx where
  // the entire "Peter Burkimsher" name + email + photo banner table
  // was wrapped in an SDT and lost.
  const directChildren = expandSdtWrappers(Array.from(container.children));

  const replaceParagraphs = ctx.replaceParagraphs ?? opts?.replaceParagraphs;

  for (const child of directChildren) {
    if (child.namespaceURI === null) continue;
    const name = child.localName;
    if (name === "p") {
      const replacement = replaceParagraphs?.get(child);
      if (replacement) {
        // Caller pre-built a Block to take this paragraph's place
        // (e.g. an InlineFrame derived from the drawing the
        // paragraph contained). Emit that block instead; do NOT
        // call convertParagraph on the source element so the
        // original text/runs don't double-render.
        blocks.push(replacement);
      } else {
        blocks.push(convertParagraph(child, ctx, activeComments));
      }
      const inlineSectPr = inlineSectPrOf(child);
      if (inlineSectPr) {
        // The just-pushed paragraph is the last one of its section.
        // Emit a SectionBreak so the AST mirrors OOXML's structural
        // boundary, and stash the sectPr to be parsed alongside.
        sectPrEls.push(inlineSectPr);
        pendingSectionIndex++;
        blocks.push({ kind: "section_break", toSectionIndex: pendingSectionIndex });
      }
    } else if (name === "tbl") {
      blocks.push(convertTable(child, ctx));
    } else if (name === "sectPr") {
      // Body-level sectPr — the document-final section.
      sectPrEls.push(child);
    } else {
      // Unknown / unhandled elements dropped silently.
    }
  }
  return { body: blocks, warnings, sectPrEls };
}

/**
 * Expand `<w:sdt>` wrappers in-place: replace each SDT with the
 * children of its `<w:sdtContent>`. Non-SDT children pass through
 * unchanged. Nested SDTs (an SDT containing another SDT) recursively
 * unwrap — Quick Parts / placeholder galleries can nest several
 * levels deep.
 *
 * SDT has the shape:
 *   <w:sdt>
 *     <w:sdtPr>...properties (alias, tag, placeholder docPart)...</w:sdtPr>
 *     <w:sdtEndPr>...</w:sdtEndPr>
 *     <w:sdtContent>...the actual paragraphs / tables / runs...</w:sdtContent>
 *   </w:sdt>
 * Only `<w:sdtContent>` matters for rendering; the metadata children
 * drive form-control behaviour that Sobree doesn't yet surface.
 */
function expandSdtWrappers(children: readonly Element[]): Element[] {
  const out: Element[] = [];
  for (const child of children) {
    if (child.namespaceURI !== null && child.localName === "sdt") {
      const content = wFirst(child, "sdtContent");
      if (content) {
        // Recurse so nested SDTs unwrap too.
        out.push(...expandSdtWrappers(Array.from(content.children)));
      }
      // SDT with no `<w:sdtContent>` (rare — placeholder-only) drops
      // silently, matching the original "unknown element" behaviour.
    } else {
      out.push(child);
    }
  }
  return out;
}

function inlineSectPrOf(p: Element): Element | null {
  const pPr = wFirst(p, "pPr");
  return pPr ? wFirst(pPr, "sectPr") : null;
}
