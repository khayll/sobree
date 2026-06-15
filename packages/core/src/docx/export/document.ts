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
import { type ExportContext, nextRevisionId } from "./context";
import { inlinesToRuns } from "./runs";

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
      bodyChildren.push(renderParagraph(block, ctx, doc, trailing));
    } else {
      bodyChildren.push(...renderBlock(block, ctx, doc));
    }
  }
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

/** Also used for header/footer part bodies. */
export function renderBlocks(
  blocks: readonly Block[],
  ctx: ExportContext,
  doc: SobreeDocument,
): string[] {
  const out: string[] = [];
  for (const block of blocks) out.push(...renderBlock(block, ctx, doc));
  return out;
}

function renderBlock(block: Block, ctx: ExportContext, doc: SobreeDocument): string[] {
  switch (block.kind) {
    case "paragraph":
      return [renderParagraph(block, ctx, doc)];
    case "table":
      return [renderTable(block, ctx, doc)];
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
): string {
  const pPr = renderPPr(p.properties, ctx, trailingSectPr);
  const runs = inlinesToRuns(p.runs, ctx, doc);
  return el("w:p", null, `${pPr}${runs}`);
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
  if (props.keepNext) parts.push(el("w:keepNext"));
  if (props.keepLines) parts.push(el("w:keepLines"));
  if (props.pageBreakBefore) parts.push(el("w:pageBreakBefore"));
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
  const rows = t.rows.map((r) => renderTableRow(r, ctx, doc)).join("");
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
