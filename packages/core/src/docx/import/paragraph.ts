import type {
  Block,
  DrawingRun,
  HyperlinkRun,
  InlineRun,
  Paragraph,
  ParagraphProperties,
  RunProperties,
  TextRun,
} from "../../doc/types";
import type { ParagraphFormat, RunFormat } from "../types";
import { type ImportedItem, readParagraph } from "./paragraphs";
import type { ImportedRun } from "./runs";

/**
 * Shared context for importing a body — rels + media lookup. Lives here
 * (rather than in `document.ts`) so `tables.ts` can pull it without
 * forming a `document.ts` ↔ `tables.ts` import cycle.
 */
export interface ConvertContext {
  /** Rels map (`rId` → target path). Used for image embed resolution. */
  rels: Map<string, string>;
  /** When true, `<w:lastRenderedPageBreak/>` markers are honoured as
   *  forced page breaks (i.e. translated to `pageBreakBefore: true`).
   *  Caller sets this after counting hints per document: a meaningful
   *  number of hints (≥3) indicates Word's layout produced reliable
   *  page boundaries; a stray single hint is usually stale and
   *  ignored. */
  honorLastRenderedPageBreaks?: boolean;
  /**
   * Pre-built replacement Blocks keyed by their source `<w:p>` element
   * (e.g. an InlineFrame derived from a drawing the paragraph hosted).
   * Lives on the CONTEXT — not a body-walker option — because host
   * paragraphs can sit anywhere a paragraph can: body, table cells,
   * nested tables. A walker that doesn't consult it silently drops the
   * replacement (the drawing was already claimed out of the XML).
   */
  replaceParagraphs?: Map<Element, Block>;
}

/**
 * Convert a single `<w:p>` element into a Paragraph block. Handles
 * paragraph formatting (heading style, alignment, spacing, numbering),
 * runs (text/hyperlink/drawing), and image embed resolution via the
 * rels map carried in `ctx`.
 */
export function convertParagraph(
  p: Element,
  ctx: ConvertContext,
  activeComments?: Set<number>,
): Paragraph {
  const { items, format } = readParagraph(p, activeComments);
  const properties = mapParagraphFormat(format);
  const inlineRuns = itemsToInlines(items, ctx);
  const honorLastRenderedPageBreaks = ctx.honorLastRenderedPageBreaks === true;
  // `<w:lastRenderedPageBreak/>` is a hint Word writes during save —
  // "the layout engine broke a page here last time we rendered". LO
  // honours it as a soft page boundary so a doc round-tripping
  // through LO retains the Word author's visual pagination.
  //
  // Caveat: an isolated single hint is often stale (the author
  // edited / resized after Word's last layout pass and the hint
  // doesn't match where LO actually breaks now). We only honour
  // hints when the importer's caller signals "this doc has enough
  // hints to be reliable" — see `shouldHonorLastRenderedPageBreaks`
  // in `index.ts` for the threshold. Without that gate, jellap.docx's
  // single stale hint added an unwanted 4th page; complex-multipage's
  // 10 hints correctly produce its 16 pages.
  if (honorLastRenderedPageBreaks && hasLeadingLastRenderedPageBreak(p)) {
    properties.pageBreakBefore = true;
  }
  return { kind: "paragraph", properties, runs: inlineRuns };
}

/**
 * Is a `<w:lastRenderedPageBreak/>` reached, in document order, BEFORE any
 * visible content of the paragraph?
 *
 * Word records a hint at the exact run position where a page broke last
 * time. A hint at the paragraph START (or on an otherwise-empty
 * paragraph) is a real page boundary — honour it as `pageBreakBefore`. A
 * hint in the MIDDLE of a paragraph marks where the paragraph's own lines
 * wrapped onto the next page; the line paginator already splits a
 * paragraph across a page boundary, so forcing the WHOLE paragraph onto a
 * new page here would strand the lines that belong on the previous page
 * (leaving it half-empty). So only a leading hint counts.
 */
function hasLeadingLastRenderedPageBreak(p: Element): boolean {
  let answer = false;
  // Pre-order DFS in document order; stop at the first hint OR first
  // visible run content, whichever comes first.
  const visit = (el: Element): boolean => {
    for (const child of Array.from(el.children)) {
      const name = child.localName;
      // Skip property containers and text-box content (a textbox break
      // is the textbox's concern, not the host paragraph's).
      if (name === "pPr" || name === "rPr" || name === "txbxContent") continue;
      if (name === "lastRenderedPageBreak" && child.namespaceURI?.includes("wordprocessingml")) {
        answer = true;
        return true;
      }
      if (isVisibleRunContent(child)) return true; // content before any hint
      if (visit(child)) return true;
    }
    return false;
  };
  visit(p);
  return answer;
}

/** Does this element represent visible, page-filling run content (so a
 *  later hint is mid-paragraph, not leading)? Whitespace-only text does
 *  not count — Word commonly emits a leading space run before content. */
function isVisibleRunContent(el: Element): boolean {
  switch (el.localName) {
    case "t":
      return (el.textContent ?? "").trim().length > 0;
    case "drawing":
    case "object":
    case "pict":
    case "tab":
    case "br":
    case "fldSimple":
    case "footnoteReference":
    case "endnoteReference":
      return true;
    default:
      return false;
  }
}

function mapParagraphFormat(f: ParagraphFormat): ParagraphProperties {
  const out: ParagraphProperties = {};
  // Style anchor:
  //   - heading → canonical `HeadingN` id (normalises `heading 1` /
  //     `Heading1` so the renderer emits `<hN>`)
  //   - otherwise → verbatim pStyle (e.g. `Title`, `ListParagraph`,
  //     `BodyText`) so the renderer's cascade picks up the style's
  //     pPr/rPr — `Title` keeps its own display font, not Heading1's.
  if (f.headingLevel && f.headingLevel >= 1 && f.headingLevel <= 6) {
    out.styleId = `Heading${f.headingLevel}`;
  } else if (f.styleId) {
    out.styleId = f.styleId;
  }
  if (f.alignment) {
    out.alignment = f.alignment === "justify" ? "both" : f.alignment;
  }
  // Build spacing from line / after / before. Even when only one of
  // them is set, we emit the object so the AST distinguishes "no
  // override" (undefined `spacing`) from "explicit value, possibly 0"
  // (e.g. `spacingAfterTwips: 0` must beat DocDefaults' 200).
  const spacing: NonNullable<ParagraphProperties["spacing"]> = {};
  if (f.lineHeight !== undefined && f.lineHeight > 0) {
    spacing.line = Math.round(240 * f.lineHeight);
    spacing.lineRule = "auto";
  }
  if (f.spacingAfterTwips !== undefined) spacing.afterTwips = f.spacingAfterTwips;
  if (f.spacingBeforeTwips !== undefined) spacing.beforeTwips = f.spacingBeforeTwips;
  if (Object.keys(spacing).length > 0) out.spacing = spacing;
  if (f.numId !== undefined) {
    out.numbering = { numId: f.numId, level: f.numLevel ?? 0 };
  }
  if (f.indent) out.indent = f.indent;
  if (f.tabStops) out.tabStops = f.tabStops;
  if (f.shading) out.shading = f.shading;
  if (f.revision) out.revision = f.revision;
  if (f.borders) out.borders = f.borders;
  // Mark-format → ParagraphProperties.runDefaults. Renderer cascades
  // these onto the paragraph element, so empty paragraphs render at
  // the paragraph mark's font (not the browser default).
  if (f.markFormat && (f.markFormat.fontFamily || f.markFormat.fontSizePt !== undefined)) {
    const runDefaults: RunProperties = { ...(out.runDefaults ?? {}) };
    if (f.markFormat.fontFamily) runDefaults.fontFamily = f.markFormat.fontFamily;
    if (f.markFormat.fontSizePt !== undefined) runDefaults.fontSizePt = f.markFormat.fontSizePt;
    out.runDefaults = runDefaults;
  }
  return out;
}

function itemsToInlines(items: ImportedItem[], ctx: ConvertContext): InlineRun[] {
  const out: InlineRun[] = [];
  for (const item of items) {
    if (item.kind === "run") {
      pushInline(item.run, ctx, out);
    } else {
      const inner: InlineRun[] = [];
      for (const run of item.runs) pushInline(run, ctx, inner);
      const href = item.href ?? (item.relId ? ctx.rels.get(item.relId) : undefined);
      const link: HyperlinkRun = {
        kind: "hyperlink",
        href: href ?? "#",
        children: inner,
      };
      out.push(link);
    }
  }
  return out;
}

function pushInline(run: ImportedRun, ctx: ConvertContext, out: InlineRun[]): void {
  if (run.drawing) {
    const drawing = drawingRunFrom(run.drawing, ctx);
    if (drawing) out.push(drawing);
    return;
  }
  if (run.footnoteRefId !== undefined) {
    out.push({
      kind: "footnoteRef",
      id: run.footnoteRefId,
      ...(run.footnoteCustomMark ? { customMark: run.footnoteCustomMark } : {}),
    });
    return;
  }
  if (run.commentRefId !== undefined) {
    out.push({ kind: "commentRef", id: run.commentRefId });
    return;
  }
  if (run.isHardBreak) {
    out.push({ kind: "break", type: run.breakType ?? "line" });
    return;
  }
  if (run.field) {
    // FieldRun — Sobree's AST shape mirrors `<w:fldSimple>`:
    // instruction (`PAGE` / `NUMPAGES` / …) plus an optional cached
    // value Word writes for viewers that don't re-evaluate.
    const fieldRun: InlineRun =
      run.field.cached !== undefined
        ? { kind: "field", instruction: run.field.instruction, cached: run.field.cached }
        : { kind: "field", instruction: run.field.instruction };
    out.push(fieldRun);
    return;
  }
  if (run.text === "") return;
  const properties = mapRunFormat(run.format);
  if (run.revision) properties.revision = run.revision;
  if (run.commentIds && run.commentIds.length > 0) properties.commentIds = run.commentIds;
  out.push(makeTextRun(run.text, properties));
}

function drawingRunFrom(
  info: NonNullable<ImportedRun["drawing"]>,
  ctx: ConvertContext,
): DrawingRun | null {
  if (!info.embedRelId) return null;
  const target = ctx.rels.get(info.embedRelId);
  if (!target) return null;
  const partPath = resolveMediaPath(target);
  const run: DrawingRun = {
    kind: "drawing",
    partPath,
    widthEmu: info.widthEmu ?? 0,
    heightEmu: info.heightEmu ?? 0,
    placement: info.anchor ? "anchor" : "inline",
  };
  if (info.altText) run.altText = info.altText;
  if (info.anchor) {
    run.anchor = {
      offsetXEmu: info.anchor.offsetXEmu,
      offsetYEmu: info.anchor.offsetYEmu,
      relativeFromH: info.anchor.relativeFromH,
      relativeFromV: info.anchor.relativeFromV,
      ...(info.anchor.behindDoc ? { behindDoc: true } : {}),
    };
  }
  return run;
}

function resolveMediaPath(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  return `word/${target}`;
}

function makeTextRun(text: string, properties: RunProperties): TextRun {
  return { kind: "text", text, properties };
}

function mapRunFormat(f: RunFormat): RunProperties {
  const out: RunProperties = {};
  if (f.styleId) out.styleId = f.styleId;
  // Toggle properties keep their explicit value (including `false`) — a direct
  // `<w:b w:val="0"/>` must reach the AST so the renderer's per-run cascade can
  // override an inherited toggle (the ACM first-author `<w:caps w:val="0"/>`).
  // Dropping `false` here (the old `if (f.caps)` guard) lower-cased nothing.
  if (f.bold !== undefined) out.bold = f.bold;
  if (f.italic !== undefined) out.italic = f.italic;
  if (f.strike !== undefined) out.strike = f.strike;
  if (f.caps !== undefined) out.caps = f.caps;
  if (f.underline) out.underline = "single";
  if (f.color) out.color = f.color.startsWith("#") ? f.color : `#${f.color}`;
  if (f.highlight) out.highlight = f.highlight;
  if (f.fontFamily) out.fontFamily = f.fontFamily;
  if (f.fontSizePt !== undefined) out.fontSizePt = f.fontSizePt;
  if (f.verticalAlign) out.verticalAlign = f.verticalAlign;
  // `<w:rPrChange>` snapshot — recursively map the before-state through
  // the same RunFormat → RunProperties conversion.
  if (f.revisionFormat) {
    const before = mapRunFormat(f.revisionFormat.before);
    const { author, date } = f.revisionFormat;
    out.revisionFormat = {
      before,
      ...(author !== undefined ? { author } : {}),
      ...(date !== undefined ? { date } : {}),
    };
  }
  return out;
}
