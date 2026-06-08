import { convertBlocksFromContainer, convertDocumentXml } from "./document";
import { convertParagraph } from "./paragraph";
import { readSection } from "./headers";
import { parseRels } from "./rels";
import { unzipDocx } from "./unzip";
import { parseFootnotesXml } from "./footnotes";
import { parseCommentsXml } from "./comments";
import { templateToBlocks } from "../../doc/pageSetupBridge";
import { parseXml } from "../shared/xml";
import type { DocxImportResult } from "../types";
import { defaultStyles, emptyDocument } from "../../doc/builders";
import { parseStylesXml } from "./styles";
import { parseNumberingXml } from "./numbering";
import { parseSettingsXml } from "./settings";
import { mountFontTableFromZip } from "../../fonts";
import { parseAnchoredFrames } from "./anchoredFrames";
import { flowDisplacingTextboxes } from "./flowFrames";
import { floatWrappingImages } from "./floatFrames";
import { parseInlineFrames } from "./inlineFrames";
import type {
  AnchoredFrame,
  Block,
  InlineFrame,
  SectionProperties,
  SobreeDocument,
} from "../../doc/types";

/**
 * Top-level entry point for importing a .docx file. Returns a native
 * `SobreeDocument` plus any warnings surfaced by the conversion.
 */
export async function importDocx(
  src: File | Blob | ArrayBuffer | Uint8Array,
): Promise<DocxImportResult> {
  const unzipped = await unzipDocx(src);
  const documentXml = unzipped.text["word/document.xml"];
  if (!documentXml) {
    throw new Error("Not a valid .docx file — missing word/document.xml");
  }
  const xml = parseXml(documentXml);
  // Run the same Markup-Compatibility + text-box preprocessing on the
  // document body that we run on header/footer parts. Without this:
  //   - `<mc:Fallback>` branches double-walk into the AST (every
  //     legacy v:shape clone becomes a duplicate paragraph).
  //   - `<w:txbxContent>` text-box content stays buried inside a
  //     `<w:drawing>` and never reaches the AST as paragraphs (e.g.
  //     jellap.docx's "* Fénykép" photo-placeholder text vanishes).
  stripMcFallbacks(xml);
  const relsXml = unzipped.text["word/_rels/document.xml.rels"];
  const rels = relsXml ? parseRels(relsXml) : new Map<string, string>();
  // Walk the body's direct paragraph children FIRST to build a stable
  // element → index map. The new floating-layer parser uses this to
  // attribute each anchored frame to the body paragraph that contained
  // its `<w:drawing>`, so the renderer can put the frame on whichever
  // page that paragraph paginates onto. Must run BEFORE the lifter,
  // which removes drawings from the XML and would orphan the lookup.
  const bodyParagraphIndexByElement = buildBodyParagraphIndex(xml);
  const anchoredFrames: AnchoredFrame[] = parseAnchoredFrames(xml, {
    rels,
    bodyParagraphIndexByElement,
    // Parse textbox bodies through the full body walker so their real
    // paragraph spacing / formatting survives — critical for frames
    // that flow into the body (see flowDisplacingTextboxes), whose
    // pagination depends on honest line heights.
    parseBlockBody: (txbxContent) =>
      convertBlocksFromContainer(txbxContent, { rels }).body,
  });
  // Parse inline-drawing frames (`<w:drawing><wp:inline>` with
  // textbox payload) into the new InlineFrame model. Phase 1.1:
  // parser runs and results land on `doc.inlineFrames` for
  // inspection / future renderer (Phase 1.2). The legacy lifter
  // ALSO still processes these drawings, so the rendered output
  // is unchanged this phase. Phase 1.4 deletes the lifter once
  // the renderer (Phase 1.2) uses the new path exclusively.
  //
  // The textbox body runs through the SAME walker as the document
  // body (`convertBlocksFromContainer`) so its paragraphs carry their
  // real run formatting (bold, font size, colour), lists, and tables —
  // not the flat text the old Phase-1.1 stub produced. The walker is
  // handed a plain `{ rels }` context: style/numbering resolution
  // happens later at render time, exactly as for body paragraphs.
  // LRPB hints INSIDE a textbox are the textbox's own pagination
  // concern, so we don't honour them here (default false).
  //
  // Same LRPB threshold the body walker uses (in `document.ts`),
  // mirrored here so the InlineFrame parser interprets
  // `<w:lastRenderedPageBreak/>` hints consistently.
  const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const lrpbCount = xml.getElementsByTagNameNS(W_NS, "lastRenderedPageBreak").length;
  const honorLastRenderedPageBreaks = lrpbCount >= 10;
  const parsedInlineFrames = parseInlineFrames(xml, {
    rels,
    parseBlockBody: (txbxContent) =>
      convertBlocksFromContainer(txbxContent, { rels }).body,
    honorLastRenderedPageBreaks,
  });
  const inlineFrames: InlineFrame[] = parsedInlineFrames.map((p) => p.frame);
  // Build the replacement map BEFORE the lifter / body walker run.
  // The body walker will encounter each `hostParagraphEl` (its
  // drawing has been removed by `parseInlineFrames` since `claim: true`
  // is the default) and emit the mapped InlineFrame block at that
  // paragraph's document-order position — directly, no DOM-attribute
  // round-trip.
  const replaceParagraphs = new Map<Element, Block>();
  for (const { hostParagraphEl, frame } of parsedInlineFrames) {
    // Capture the host paragraph's resolved properties (spacing,
    // alignment, …) so the renderer reserves the same vertical box
    // Word does — drawing height PLUS the host paragraph's
    // spacing-after (commonly Normal's `<w:spacing w:after="200">`).
    // The drawing was already removed by parseInlineFrames' claim
    // pass, so convertParagraph here parses just the host pPr.
    frame.hostProps = convertParagraph(hostParagraphEl, { rels }).properties;
    replaceParagraphs.set(hostParagraphEl, frame);
  }

  const { body: rawBody, warnings, sectPrEls } = convertDocumentXml(xml, { rels }, {
    replaceParagraphs,
  });

  // Displacing anchored textboxes (wrapping, paragraph-anchored,
  // content-only boxes) are really framed body content — splice them
  // into the flow at their anchor paragraph so they paginate instead
  // of clipping in the absolute overlay. Pure decorations (pictures,
  // bordered boxes, behind-text, wrapNone floats) stay in
  // `anchoredFrames`.
  const { body: flowedBody, frames: flowedFrames } = flowDisplacingTextboxes(
    rawBody,
    anchoredFrames,
  );

  // Build all sections from the collected sectPrs (inline + body-level).
  // Each section's headerRefs/footerRefs are resolved through `rels` to
  // partIds; the referenced header/footer XML parts are loaded into
  // `headerFooterBodies` so the editor can render them.
  const sections = sectPrEls.map((el) => readSection(el, rels));

  // Wrap-mode anchored PICTURES (square/tight/through) become CSS floats at
  // the head of their anchor paragraph so body text flows around them.
  // Needs section page geometry to pick the float side for `bothSides`, so
  // it runs after `sections` is built (and after the textbox-flow pass,
  // whose body edits keep paragraph indices stable).
  const { body, frames: finalAnchoredFrames } = floatWrappingImages(
    flowedBody,
    flowedFrames,
    sections,
  );

  const { bodies: headerFooterBodies, frames: headerFooterFrames } =
    loadHeaderFooterParts(sections, unzipped.text, rels);

  // Thread `word/*` media and other embedded binary parts through the AST
  // so the export path can round-trip them. Keyed by ZIP-level path so
  // DrawingRun.partPath matches directly.
  const rawParts: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(unzipped.binary)) {
    rawParts[path] = bytes;
  }

  // Font declarations + embedded font binaries. The bytes are already
  // in `rawParts` from the unzip pass — `mountFontTableFromZip` just
  // parses the metadata so renderer-side @font-face can deobfuscate
  // on demand. Round-trip is byte-faithful when nothing changes.
  const fonts = mountFontTableFromZip(unzipped.text, parseRels);

  // Read settings.xml first — `compatibilityMode` + auto-spacing flag
  // gate whether parseStylesXml injects Word's implicit Normal-style
  // baseline (line ≈ 1.08, after = 8pt). See settings.ts for the
  // exact rule.
  const settings = parseSettingsXml(unzipped.text["word/settings.xml"]);
  // Pull the actual style catalogue from `word/styles.xml` so the
  // imported doc's typography (Calibri / Cambria heading, etc.)
  // survives. Only fall back to Sobree's synthesised defaults when
  // the docx genuinely omits styles.xml or the parse fails.
  const importedStyles = parseStylesXml(unzipped.text["word/styles.xml"], settings);
  const footnotes = parseFootnotesXml(unzipped.text["word/footnotes.xml"], { rels });
  const comments = parseCommentsXml(
    unzipped.text["word/comments.xml"],
    { rels },
    unzipped.text["word/commentsExtended.xml"],
  );
  const doc: SobreeDocument = {
    body,
    sections: sections.length > 0 ? sections : [fallbackSection()],
    headerFooterBodies,
    styles: importedStyles ?? defaultStyles(),
    // Parse the docx's numbering definitions so the renderer can apply
    // per-level indentation (matches Word's ruler markers). Without
    // this, every list defaults to a hardcoded CSS padding-left.
    numbering: parseNumberingXml(unzipped.text["word/numbering.xml"]),
    rawParts,
    fonts,
    ...(Object.keys(footnotes).length > 0 ? { footnotes } : {}),
    ...(Object.keys(comments).length > 0 ? { comments } : {}),
    // Surface document-wide layout settings (e.g. defaultTabStop) so
    // the renderer can apply per-document tab geometry instead of
    // falling back to CSS's 8-char default.
    ...(settings.defaultTabStopTwips !== undefined
      ? { settings: { defaultTabStopTwips: settings.defaultTabStopTwips } }
      : {}),
    ...(finalAnchoredFrames.length > 0 ? { anchoredFrames: finalAnchoredFrames } : {}),
    ...(Object.keys(headerFooterFrames).length > 0 ? { headerFooterFrames } : {}),
    ...(inlineFrames.length > 0 ? { inlineFrames } : {}),
  };
  // If the doc was truly empty, give it a blank paragraph so Word opens it.
  if (doc.body.length === 0) {
    doc.body.push({ kind: "paragraph", properties: {}, runs: [] });
  }

  return { document: doc, warnings };
}

/**
 * Load every header/footer XML part referenced from any section,
 * deduped by partId.
 *
 * Each part is converted through the same `convertBlocksFromContainer`
 * walker the document body uses — so headers/footers carry the full
 * rich AST: formatted runs, drawings, tables, comment ranges,
 * revisions. The renderer treats `headerFooterBodies[partId]` exactly
 * like body content.
 *
 * `mc:AlternateContent` fallbacks are stripped first so duplicate
 * paragraphs (one from `mc:Choice`, one from `mc:Fallback`) don't
 * end up in the body twice — see {@link stripMcFallbacks} for the
 * rationale.
 *
 * Per-part `rels` aren't loaded here yet: header/footer references to
 * media use the document-level rels map, which works for embedded
 * images that live in `word/media/*`. If headers ever need their own
 * `_rels/header1.xml.rels` (rare), that's a follow-up.
 */
function loadHeaderFooterParts(
  sections: readonly SectionProperties[],
  textParts: Record<string, string>,
  rels: Map<string, string>,
): { bodies: Record<string, Block[]>; frames: Record<string, AnchoredFrame[]> } {
  const bodies: Record<string, Block[]> = {};
  const frames: Record<string, AnchoredFrame[]> = {};
  const seen = new Set<string>();
  for (const section of sections) {
    for (const ref of [...section.headerRefs, ...section.footerRefs]) {
      if (seen.has(ref.partId)) continue;
      seen.add(ref.partId);
      const xml = textParts[`word/${ref.partId}`];
      if (!xml) continue;
      const parsed = parseXml(xml);
      stripMcFallbacks(parsed);
      // Per-part rels: `word/_rels/header1.xml.rels` defines this
      // header's own rId → target mapping (image embeds, hyperlinks,
      // etc.). Without it, a `<a:blip r:embed="rId4">` inside the
      // header gets resolved against the *document*-level rels map,
      // which has an unrelated rId4 — leading to wrong-image-target
      // bugs like jellap.docx's logo pointing at customXml/item1.xml.
      // Fall back to the document rels for headers that don't have a
      // dedicated rels file (rare but valid for header parts with no
      // external references).
      const headerRelsXml = textParts[`word/_rels/${ref.partId}.rels`];
      const headerRels = headerRelsXml
        ? mergeRels(parseRels(headerRelsXml), rels)
        : rels;
      // Extract floating frames FIRST: `parseAnchoredFrames` claims
      // (removes) each anchored `<w:drawing>` from the XML so the flow
      // walker below doesn't also render it (double-render). Map the part's
      // own paragraph children to indices so a `verticalFrom="paragraph"`
      // frame records which header/footer paragraph it anchors to (the
      // renderer then positions it at that paragraph's rendered Y, same as
      // body frames). Textbox bodies run through the same block walker as
      // the document body so their formatting/lists/tables survive.
      const root = parsed.documentElement;
      const partFrames = parseAnchoredFrames(parsed, {
        rels: headerRels,
        bodyParagraphIndexByElement: paragraphIndexInContainer(root),
        parseBlockBody: (txbxContent) =>
          convertBlocksFromContainer(txbxContent, { rels: headerRels }).body,
      });
      if (partFrames.length > 0) frames[ref.partId] = partFrames;
      // Header part roots: `<w:hdr>` or `<w:ftr>`. Both wrap a stream
      // of paragraphs + tables identical in shape to `<w:body>`.
      const { body } = convertBlocksFromContainer(root, { rels: headerRels });
      bodies[ref.partId] = body;
    }
  }
  return { bodies, frames };
}

/**
 * Merge two rels maps with `primary` taking precedence. Used so a
 * header part's own rels override any document-level rId collision
 * (Word numbers rIds independently per part — the same rId number in
 * document.xml.rels and header1.xml.rels typically points at totally
 * different targets).
 */
function mergeRels(
  primary: Map<string, string>,
  fallback: Map<string, string>,
): Map<string, string> {
  const out = new Map(fallback);
  for (const [id, target] of primary) out.set(id, target);
  return out;
}

/**
 * OOXML uses `<mc:AlternateContent>` to provide both a modern
 * `<mc:Choice Requires="...">` branch and a legacy `<mc:Fallback>`
 * branch. A consumer should pick one (per ECMA-376 §23.2); without
 * stripping Fallback first, the walker descends into BOTH and the
 * content (e.g. text-box paragraphs) duplicates.
 */
/**
 * Walk the document body's direct `<w:p>` children in document order
 * and return an element→index map. Used by the anchored-frames parser
 * to attribute each frame to the body paragraph that contains its
 * `<w:drawing>`, so the renderer can pin the frame to the right page
 * after pagination. Header / footer paragraphs deliberately excluded —
 * they belong to their own zones and don't have body-page positions.
 */
function buildBodyParagraphIndex(doc: Document): Map<Element, number> {
  const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const body = doc.getElementsByTagNameNS(W_NS, "body")[0];
  return body ? paragraphIndexInContainer(body) : new Map();
}

/**
 * Map a block container's direct `<w:p>` children to their block index
 * (the index `convertBlocksFromContainer` will assign and the renderer
 * stamps as `data-block-index`). Tables advance the counter — anchored
 * frames live inside paragraphs, not tables, so the table element itself
 * isn't mapped, but the indices must still line up with the block list.
 * Used for `<w:body>`, `<w:hdr>` and `<w:ftr>` alike so anchored frames in
 * any of them can record their anchor paragraph.
 */
function paragraphIndexInContainer(container: Element): Map<Element, number> {
  const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const map = new Map<Element, number>();
  let index = 0;
  for (const child of Array.from(container.children)) {
    if (child.namespaceURI === W_NS && child.localName === "p") {
      map.set(child, index);
      index++;
    } else if (child.namespaceURI === W_NS && child.localName === "tbl") {
      index++;
    }
  }
  return map;
}

function stripMcFallbacks(doc: Document): void {
  const MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006";
  const fallbacks = Array.from(doc.getElementsByTagNameNS(MC_NS, "Fallback"));
  for (const f of fallbacks) f.parentNode?.removeChild(f);
}

/**
 * Synthesize a default section when the .docx contains no `<w:sectPr>`
 * at all (degenerate, but Word's reader is permissive). A4 portrait,
 * 1" margins — same defaults as `defaultSection()`.
 */
function fallbackSection(): SectionProperties {
  return {
    pageSize: { wTwips: 11906, hTwips: 16838, orientation: "portrait" },
    pageMargins: {
      topTwips: 1440,
      rightTwips: 1440,
      bottomTwips: 1440,
      leftTwips: 1440,
      headerTwips: 720,
      footerTwips: 720,
      gutterTwips: 0,
    },
    headerRefs: [],
    footerRefs: [],
  };
}

// Re-export types for callers.
export type { Block, SobreeDocument };
export { emptyDocument };

// `headerFooterBodies` templating uses `templateToBlocks` internally; expose
// it for tests and consumers that want the same rendering.
export { templateToBlocks };
