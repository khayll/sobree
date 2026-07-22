import type {
  Block,
  Paragraph,
  ParagraphProperties,
  SobreeDocument,
  Table,
  TableCell,
  TableRow,
} from "../../doc/types";
import { ROOT_DOCUMENT_ATTRS } from "../shared/namespaces";
import { el, xmlDocument } from "../shared/xml";
import { anchorRunsByParagraph } from "./anchors";
import { type ExportContext, nextRevisionId } from "./context";
import { renderInlineFrameRuns } from "./inlineFrames";
import { closeAllCommentRanges, inlinesToRuns } from "./runs";

/**
 * Render the SobreeDocument body into `word/document.xml` (string form).
 *
 * `sectPrXmls` is the parallel array from `emitHeadersAndFooters` —
 * one per section. Non-final sections' sectPr is spliced into the
 * `<w:pPr>` of the LAST PARAGRAPH of that section's body range (OOXML
 * convention; ECMA-376 §17.6.18). The final section's sectPr lands at
 * body level after the last block. `SectionBreak` blocks themselves
 * produce no output — they're delimiters whose semantics are carried
 * by the spliced sectPr.
 *
 * `ctx` is mutated as drawings are encountered — each image registers
 * a relationship and a ZIP media part.
 */
export function renderDocumentXml(
  doc: SobreeDocument,
  sectPrXmls: readonly string[],
  ctx: ExportContext,
): string {
  // Compute which body paragraph each non-final section's sectPr
  // attaches to. Section i (i < N-1) ends at the i-th SectionBreak;
  // the last paragraph of section i sits immediately before that break.
  const trailingSectPr = computeTrailingSectPr(doc.body, sectPrXmls);
  const finalSectPrXml = sectPrXmls[sectPrXmls.length - 1] ?? "";

  // Anchored frames, keyed by their host paragraph's BODY index — the
  // space `anchor.paragraphIndex` lives in (`paragraphIndexInContainer`
  // promises AST block indices). Each paragraph claims its anchors as a
  // leading run; frames keyed at a non-paragraph block fall back to the
  // first paragraph so nothing is silently dropped.
  const anchorRuns = normalizeAnchorKeys(anchorRunsByParagraph(doc, ctx, renderBlocks), doc.body);

  const bodyChildren: string[] = [];
  for (let i = 0; i < doc.body.length; i++) {
    const block = doc.body[i];
    if (!block) continue;
    if (block.kind === "section_break") {
      // No own output — its sectPr was attached to the previous paragraph.
      continue;
    }
    if (block.kind === "paragraph") {
      const trailing = trailingSectPr.get(i);
      const leading = anchorRuns.get(i);
      bodyChildren.push(renderParagraph(block, ctx, doc, trailing, leading));
    } else {
      bodyChildren.push(...renderBlock(block, ctx, doc));
    }
  }
  // The body is a content stream too — close any comment range dangling
  // past the last run (renderDocumentXml walks the body itself for sectPr
  // splicing, so it can't lean on renderBlocks' stream-end close).
  const dangling = closeAllCommentRanges(ctx);
  if (dangling) bodyChildren.push(dangling);
  bodyChildren.push(finalSectPrXml);
  const body = el("w:body", null, bodyChildren);
  return xmlDocument(el("w:document", ROOT_DOCUMENT_ATTRS, body));
}

/**
 * Build a `bodyIndex → sectPrXml` map for paragraphs that need a
 * trailing `<w:sectPr>`. For each non-final section i (with sectPrXmls
 * indexed 0..N-2), the i-th `SectionBreak` in the body marks where
 * section i ends; the paragraph immediately before it gets the sectPr.
 *
 * Edge case: if a section's range is empty (the break is at body[0]
 * or two breaks are adjacent), the sectPr would be orphaned. That
 * shape doesn't appear in well-formed Sobree documents — the editor
 * doesn't allow adjacent breaks — but if it does we silently drop the
 * section's sectPr rather than synthesise an empty paragraph.
 */
function computeTrailingSectPr(
  body: readonly Block[],
  sectPrXmls: readonly string[],
): Map<number, string> {
  const map = new Map<number, string>();
  let sectionIdx = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i]?.kind !== "section_break") continue;
    if (sectionIdx >= sectPrXmls.length - 1) break;
    // Walk backwards from the break to find the nearest paragraph in
    // this section; that's where the sectPr attaches.
    for (let j = i - 1; j >= 0; j--) {
      const candidate = body[j];
      if (!candidate) continue;
      if (candidate.kind === "section_break") break; // empty section, skip
      if (candidate.kind === "paragraph") {
        const xml = sectPrXmls[sectionIdx];
        if (xml) map.set(j, xml);
        break;
      }
      // Tables can't host sectPr in their pPr. If the only block in the
      // section is a table, the sectPr is dropped — Word will fall back
      // to the document-final sectPr's settings for that range.
    }
    sectionIdx++;
  }
  return map;
}

/**
 * Render one content STREAM — the document body, a header/footer part
 * body, a table cell, or a footnote/comment body. Comment ranges open and
 * close within a stream (`ctx.openComments` threads run-level transitions
 * across its paragraphs); any range still dangling after the last block
 * gets its end marker appended here so no `commentRangeStart` leaves the
 * stream unbalanced.
 */
export function renderBlocks(
  blocks: readonly Block[],
  ctx: ExportContext,
  doc: SobreeDocument,
  /** Anchor runs to inject as leading runs, keyed by index within
   *  `blocks` — header/footer parts thread their floating frames here.
   *  The body walk does its own injection (it also splices sectPrs). */
  anchorRuns?: Map<number, string>,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block) continue;
    if (block.kind === "paragraph") {
      out.push(renderParagraph(block, ctx, doc, undefined, anchorRuns?.get(i)));
    } else {
      out.push(...renderBlock(block, ctx, doc));
    }
  }
  const dangling = closeAllCommentRanges(ctx);
  if (dangling) out.push(dangling);
  return out;
}

function renderBlock(block: Block, ctx: ExportContext, doc: SobreeDocument): string[] {
  switch (block.kind) {
    case "paragraph":
      return [renderParagraph(block, ctx, doc)];
    case "table":
      return [renderTable(block, ctx, doc)];
    case "inline_frame": {
      // The frame re-emits inside a host paragraph carrying the block's
      // captured pPr (spacing/alignment) plus its break directives — the
      // exact shape `parseInlineFrames` / the band pass read them from.
      const runs = renderInlineFrameRuns(block, ctx, doc, (b, c, d) => renderBlocks(b, c, d));
      if (runs === null) return []; // shape-only frames: documented gap
      const props: ParagraphProperties = {
        ...(block.hostProps ?? {}),
        ...(block.pageBreakBefore ? { pageBreakBefore: true } : {}),
        ...(block.keepNext ? { keepNext: true } : {}),
      };
      return [el("w:p", null, `${renderPPr(props, ctx)}${runs}`)];
    }
    case "section_break":
      return [];
    default:
      return [];
  }
}

/**
 * Render `<w:p>`. If `trailingSectPr` is provided, splice it into the
 * paragraph's `<w:pPr>` — this is OOXML's "the section ends here"
 * convention (the sectPr lives inside the LAST paragraph's pPr of
 * each non-final section).
 */
function renderParagraph(
  p: Paragraph,
  ctx: ExportContext,
  doc: SobreeDocument,
  trailingSectPr?: string,
  leadingRuns?: string,
): string {
  const pPr = renderPPr(p.properties, ctx, trailingSectPr);
  const runs = inlinesToRuns(p.runs, ctx, doc);
  return el("w:p", null, `${pPr}${leadingRuns ?? ""}${runs}`);
}

/**
 * Re-key anchor runs so every entry lands on a real PARAGRAPH body index.
 * A key at a table / section_break index or past the end (possible for
 * API-built frames whose `paragraphIndex` went stale) folds into the
 * first paragraph — a degraded position beats dropping the frame.
 */
export function normalizeAnchorKeys(
  anchorRuns: Map<number, string>,
  body: readonly Block[],
): Map<number, string> {
  if (anchorRuns.size === 0) return anchorRuns;
  const first = body.findIndex((b) => b.kind === "paragraph");
  if (first < 0) return new Map(); // no paragraphs at all
  const out = new Map<number, string>();
  for (const [key, xml] of anchorRuns) {
    const target = body[key]?.kind === "paragraph" ? key : first;
    out.set(target, (out.get(target) ?? "") + xml);
  }
  return out;
}

/** Serialise a CT_OnOff pPr flag, preserving the tri-state the importer
 *  reads: `true` → bare element, `false` → the explicit-off form
 *  (`w:val="0"`), which a direct paragraph uses to override the flag its
 *  style cascade turns on. Callers skip the element entirely for
 *  `undefined` (inherit). */
function onOffEl(tag: string, on: boolean): string {
  return on ? el(tag) : el(tag, { "w:val": "0" });
}

function renderPPr(
  props: ParagraphProperties,
  ctx: ExportContext,
  trailingSectPr?: string,
): string {
  const parts: string[] = [];
  if (props.styleId) parts.push(el("w:pStyle", { "w:val": props.styleId }));
  if (props.numbering) {
    parts.push(
      el(
        "w:numPr",
        null,
        `${el("w:ilvl", { "w:val": props.numbering.level })}${el("w:numId", { "w:val": props.numbering.numId })}`,
      ),
    );
  }
  if (props.alignment && props.alignment !== "left") {
    parts.push(el("w:jc", { "w:val": props.alignment }));
  }
  if (props.spacing) {
    const attrs: Record<string, string | number> = {};
    if (props.spacing.beforeTwips !== undefined) attrs["w:before"] = props.spacing.beforeTwips;
    if (props.spacing.afterTwips !== undefined) attrs["w:after"] = props.spacing.afterTwips;
    if (props.spacing.line !== undefined) attrs["w:line"] = props.spacing.line;
    if (props.spacing.lineRule) attrs["w:lineRule"] = props.spacing.lineRule;
    if (Object.keys(attrs).length > 0) parts.push(el("w:spacing", attrs));
  }
  if (props.indent) {
    const attrs: Record<string, string | number> = {};
    if (props.indent.leftTwips !== undefined) attrs["w:left"] = props.indent.leftTwips;
    if (props.indent.rightTwips !== undefined) attrs["w:right"] = props.indent.rightTwips;
    if (props.indent.firstLineTwips !== undefined)
      attrs["w:firstLine"] = props.indent.firstLineTwips;
    if (props.indent.hangingTwips !== undefined) attrs["w:hanging"] = props.indent.hangingTwips;
    if (Object.keys(attrs).length > 0) parts.push(el("w:ind", attrs));
  }
  // CT_PPr schema orders `contextualSpacing` immediately after `ind`.
  if (props.contextualSpacing !== undefined)
    parts.push(onOffEl("w:contextualSpacing", props.contextualSpacing));
  if (props.borders?.bottom) {
    const b = props.borders.bottom;
    parts.push(
      el(
        "w:pBdr",
        null,
        el("w:bottom", {
          "w:val": b.style,
          "w:sz": b.sizeEighthsOfPt,
          "w:space": b.spaceTwips ?? 1,
          "w:color": b.color,
        }),
      ),
    );
  }
  if (props.keepNext !== undefined) parts.push(onOffEl("w:keepNext", props.keepNext));
  if (props.keepLines !== undefined) parts.push(onOffEl("w:keepLines", props.keepLines));
  if (props.pageBreakBefore !== undefined) {
    parts.push(onOffEl("w:pageBreakBefore", props.pageBreakBefore));
  }
  // Paragraph-mark revision — `<w:pPr><w:rPr><w:ins .../></w:rPr></w:pPr>`
  // (ECMA-376 §17.13.5.20 for ins, §17.13.5.14 for del). The `<w:rPr>`
  // inside pPr targets the paragraph mark itself, not the run text.
  if (props.revision) {
    const rev = props.revision;
    const tag = rev.type === "ins" ? "w:ins" : "w:del";
    const attrs: Record<string, string | number> = {
      "w:id": nextRevisionId(ctx),
    };
    if (rev.author !== undefined) attrs["w:author"] = rev.author;
    if (rev.date !== undefined) attrs["w:date"] = rev.date;
    parts.push(el("w:rPr", null, el(tag, attrs)));
  }
  // Trailing sectPr — last in pPr child order per CT_PPr. Means "this
  // paragraph is the last one of its section; here are the section's
  // properties." Section-end semantics in OOXML.
  if (trailingSectPr) parts.push(trailingSectPr);
  return parts.length > 0 ? el("w:pPr", null, parts) : "";
}

function renderTable(t: Table, ctx: ExportContext, doc: SobreeDocument): string {
  // Isolate comment-range state across the table, mirroring the importer
  // (which parses cell content with fresh `activeComments` sets): a
  // body-level range open across the table must not see the cells' runs —
  // their missing ids would read as a transition and emit a bogus end
  // marker inside the first cell.
  const outerOpen = ctx.openComments;
  ctx.openComments = new Set();
  const rows = t.rows.map((r) => renderTableRow(r, ctx, doc)).join("");
  ctx.openComments = outerOpen;
  const grid = el(
    "w:tblGrid",
    null,
    t.grid.map((w) => el("w:gridCol", { "w:w": w })),
  );
  const props = el(
    "w:tblPr",
    null,
    t.properties.widthTwips !== undefined
      ? el("w:tblW", { "w:w": t.properties.widthTwips, "w:type": "dxa" })
      : el("w:tblW", { "w:w": 0, "w:type": "auto" }),
  );
  return el("w:tbl", null, `${props}${grid}${rows}`);
}

function renderTableRow(row: TableRow, ctx: ExportContext, doc: SobreeDocument): string {
  const trPr = row.isHeader ? el("w:trPr", null, el("w:tblHeader")) : "";
  const cells = row.cells.map((c) => renderTableCell(c, ctx, doc)).join("");
  return el("w:tr", null, `${trPr}${cells}`);
}

function renderTableCell(cell: TableCell, ctx: ExportContext, doc: SobreeDocument): string {
  const props: string[] = [];
  if (cell.gridSpan && cell.gridSpan > 1) {
    props.push(el("w:gridSpan", { "w:val": cell.gridSpan }));
  }
  if (cell.vMerge) props.push(el("w:vMerge", { "w:val": cell.vMerge }));
  if (cell.verticalAlign) props.push(el("w:vAlign", { "w:val": cell.verticalAlign }));
  const tcPr = props.length > 0 ? el("w:tcPr", null, props) : "";
  const body = cell.content.flatMap((b) => renderBlock(b, ctx, doc)).join("");
  // Word requires every table cell to end with a paragraph. If the content
  // list doesn't already, emit a blank one.
  const tail = cell.content[cell.content.length - 1]?.kind === "paragraph" ? "" : el("w:p");
  return el("w:tc", null, `${tcPr}${body}${tail}`);
}
