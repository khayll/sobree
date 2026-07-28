import type {
  DrawingRun,
  HyperlinkRun,
  InlineRun,
  RevisionMark,
  RunProperties,
  SobreeDocument,
} from "../../doc/types";
import { ptToHalfPt } from "../shared/units";
import { el, escapeXmlText } from "../shared/xml";
import {
  type ExportContext,
  allocHyperlinkRel,
  allocImageRel,
  nextDocPr,
  nextRevisionId,
} from "./context";
import { renderDrawing } from "./drawings";

/**
 * Render a list of InlineRuns into concatenated `<w:r>` / `<w:fldSimple>`
 * / `<w:drawing>` XML. Drawings use `ctx` to allocate a relationship id
 * and register the underlying media part.
 */
export function inlinesToRuns(
  inlines: readonly InlineRun[],
  ctx: ExportContext,
  doc: SobreeDocument,
): string {
  // Group consecutive runs that share the same tracked-revision marker
  // (same type + same author) so we wrap them in ONE `<w:ins>` /
  // `<w:del>` element — Word renders them as a single revision span,
  // which matches the AST's coalescing semantics in `getRevisions`.
  // Runs with no revision pass through bare.
  const parts: string[] = [];
  let i = 0;
  while (i < inlines.length) {
    const run = inlines[i]!;
    // Comment range reconstruction — the inverse of the importer's
    // `activeComments` tagging. `RunProperties.commentIds` marks WHICH
    // runs a comment covers; the wire format wants explicit
    // `<w:commentRangeStart/End>` markers between runs. Emit a start
    // where an id first appears and an end where it stops, threading
    // `ctx.openComments` across paragraphs for multi-paragraph ranges.
    // The end lands exactly before the run that dropped the id — for an
    // imported doc that's the `CommentRefRun` anchor, reproducing
    // Word's `…rangeEnd → commentReference` order.
    parts.push(commentRangeTransitions(ctx, commentIdsOf(run)));
    const rev = revisionOf(run);
    if (!rev) {
      parts.push(emitInline(run, ctx, doc));
      i += 1;
      continue;
    }
    // Extend the group while next run carries the *same* revision.
    let j = i + 1;
    while (j < inlines.length) {
      const r2 = revisionOf(inlines[j]!);
      if (!r2 || r2.type !== rev.type || r2.author !== rev.author || r2.date !== rev.date) {
        break;
      }
      j += 1;
    }
    const inner = inlines
      .slice(i, j)
      .map((r) => emitInline(r, ctx, doc, rev.type === "del"))
      .join("");
    parts.push(wrapRevision(rev, inner, ctx));
    i = j;
  }
  return parts.join("");
}

/** Pull the revision marker off a run, if any. Only text runs in v1. */
function revisionOf(run: InlineRun): RevisionMark | undefined {
  if (run.kind !== "text") return undefined;
  return run.properties.revision;
}

/** The comment ids covering a run (empty set when untagged). */
function commentIdsOf(run: InlineRun): ReadonlySet<number> {
  const props = (run as { properties?: RunProperties }).properties;
  return new Set(props?.commentIds ?? []);
}

/**
 * Emit the `<w:commentRangeEnd>` / `<w:commentRangeStart>` markers the
 * transition from `ctx.openComments` to `now` requires, updating the set.
 * Ends come first (they close before the run that dropped the id), starts
 * second. Ascending id order keeps the output deterministic.
 */
function commentRangeTransitions(ctx: ExportContext, now: ReadonlySet<number>): string {
  const parts: string[] = [];
  for (const id of [...ctx.openComments].sort((a, b) => a - b)) {
    if (!now.has(id)) {
      parts.push(el("w:commentRangeEnd", { "w:id": id }));
      ctx.openComments.delete(id);
    }
  }
  for (const id of [...now].sort((a, b) => a - b)) {
    if (!ctx.openComments.has(id)) {
      parts.push(el("w:commentRangeStart", { "w:id": id }));
      ctx.openComments.add(id);
    }
  }
  return parts.join("");
}

/**
 * Close every comment range still open at the end of a content STREAM
 * (document body, table cell, header/footer or note body — each is one
 * `renderBlocks` call). Within a stream the run-level transitions place
 * every end marker; a range dangling past the last run gets its
 * `<w:commentRangeEnd>` appended as a block-level sibling (valid per
 * ECMA-376 — `CT_MarkupRange` lives in `EG_ContentBlockContent` too), so
 * no `commentRangeStart` is ever left unbalanced in the package.
 */
export function closeAllCommentRanges(ctx: ExportContext): string {
  const parts: string[] = [];
  for (const id of [...ctx.openComments].sort((a, b) => a - b)) {
    parts.push(el("w:commentRangeEnd", { "w:id": id }));
  }
  ctx.openComments.clear();
  return parts.join("");
}

/**
 * Wrap `inner` (already-emitted `<w:r>` xml) in a `<w:ins>` or `<w:del>`
 * element carrying the revision id + author + date attributes Word
 * expects. The marker is removed from `<w:rPr>` of the inner run by
 * `propsToRPr` so it doesn't get serialised twice.
 */
function wrapRevision(rev: RevisionMark, inner: string, ctx: ExportContext): string {
  const tag = rev.type === "ins" ? "w:ins" : "w:del";
  const attrs: Record<string, string | number> = {
    "w:id": nextRevisionId(ctx),
  };
  if (rev.author !== undefined) attrs["w:author"] = rev.author;
  if (rev.date !== undefined) attrs["w:date"] = rev.date;
  return el(tag, attrs, inner);
}

function emitInline(
  run: InlineRun,
  ctx: ExportContext,
  doc: SobreeDocument,
  insideDel = false,
): string {
  switch (run.kind) {
    case "text":
      return emitTextRun(run.text, run.properties, ctx, insideDel);
    case "break":
      return emitBreak(run.type);
    case "tab":
      return emitRun([el("w:tab")], run.properties, ctx);
    case "field":
      return emitField(run.instruction, run.cached ?? "", run.properties, ctx);
    case "hyperlink":
      return emitHyperlink(run, ctx, doc);
    case "drawing":
      return emitDrawing(run, ctx, doc);
    case "footnoteRef": {
      // `customMarkFollows` suppresses Word's auto-number; the mark text
      // rides in the same run right after the reference — the exact shape
      // the importer parses back into `customMark`.
      const ref = run.customMark
        ? el("w:footnoteReference", { "w:customMarkFollows": 1, "w:id": run.id }) +
          el("w:t", { "xml:space": "preserve" }, escapeXmlText(run.customMark))
        : el("w:footnoteReference", { "w:id": run.id });
      return emitRun([ref], run.properties, ctx);
    }
    case "commentRef":
      return emitRun([el("w:commentReference", { "w:id": run.id })], run.properties, ctx);
    case "bookmarkStart":
      // Paragraph-level marker, NOT wrapped in <w:r> — EG_PContent
      // allows it as a sibling of runs, which is where Word writes it.
      return el("w:bookmarkStart", { "w:id": run.id, "w:name": run.name });
    case "bookmarkEnd":
      return el("w:bookmarkEnd", { "w:id": run.id });
    default:
      return "";
  }
}

function emitHyperlink(link: HyperlinkRun, ctx: ExportContext, doc: SobreeDocument): string {
  const innerRuns = inlinesToRuns(link.children, ctx, doc);
  if (!link.href) return innerRuns;
  const rId = allocHyperlinkRel(ctx, link.href);
  return el("w:hyperlink", { "r:id": rId, "w:history": 1 }, innerRuns);
}

function emitDrawing(run: DrawingRun, ctx: ExportContext, doc: SobreeDocument): string {
  const rId = allocImageRel(ctx, run.partPath, doc);
  if (!rId) {
    // Media bytes missing — fall back to alt text so the doc still opens.
    return run.altText ? emitTextRun(run.altText, {}, ctx) : "";
  }
  return renderDrawing(run, rId, nextDocPr(ctx));
}

function emitTextRun(
  text: string,
  props: RunProperties,
  ctx: ExportContext,
  insideDel = false,
): string {
  // Inside a `<w:del>` wrapper the run's text element is `<w:delText>`,
  // per ECMA-376 §17.4.13: deleted text is serialised differently so
  // viewers that strip revisions can quietly drop it.
  const tag = insideDel ? "w:delText" : "w:t";
  const body = el(tag, { "xml:space": "preserve" }, escapeXmlText(text));
  return emitRun([body], props, ctx);
}

function emitBreak(type: "line" | "page" | "column"): string {
  const attrs = type === "line" ? undefined : { "w:type": type === "page" ? "page" : "column" };
  // No props on bare break runs, no ctx needed.
  return el("w:r", null, el("w:br", attrs ?? null));
}

function emitField(
  instr: string,
  cached: string,
  props: RunProperties | undefined,
  ctx: ExportContext,
): string {
  const padded = ` ${instr.trim()} `;
  return el(
    "w:fldSimple",
    { "w:instr": padded },
    el(
      "w:r",
      null,
      [
        propsToRPr(props ?? {}, ctx),
        el("w:t", { "xml:space": "preserve" }, escapeXmlText(cached)),
      ].join(""),
    ),
  );
}

function emitRun(
  bodyElements: string[],
  props: RunProperties | undefined,
  ctx: ExportContext,
): string {
  const rPr = propsToRPr(props ?? {}, ctx);
  return el("w:r", null, `${rPr}${bodyElements.join("")}`);
}

function propsToRPr(props: RunProperties, ctx?: ExportContext): string {
  const parts = rprChildElements(props);
  // `<w:rPrChange>` — snapshot of the run's pre-tracking properties.
  // Lives inside `<w:rPr>` per ECMA-376 §17.13.5.32. The snapshot
  // re-uses the same property-emitter, so a tracked bold-then-italic
  // round-trips exactly.
  if (props.revisionFormat && ctx) {
    const rf = props.revisionFormat;
    const attrs: Record<string, string | number> = {
      "w:id": nextRevisionId(ctx),
    };
    if (rf.author !== undefined) attrs["w:author"] = rf.author;
    if (rf.date !== undefined) attrs["w:date"] = rf.date;
    // The snapshot's `before` itself shouldn't carry `revisionFormat`
    // (recursion-free by `RunProperties.revisionFormat` contract), so
    // we render its rPr children directly.
    const beforeChildren = rprChildElements(rf.before);
    const innerRPr = beforeChildren.length > 0 ? el("w:rPr", null, beforeChildren) : el("w:rPr");
    parts.push(el("w:rPrChange", attrs, innerRPr));
  }
  return parts.length > 0 ? el("w:rPr", null, parts) : "";
}

/**
 * Render just the child elements of a `<w:rPr>` — the bold/italic/etc.
 * marker elements — without the outer wrapper. Used by `propsToRPr`
 * for the current run AND for the `<w:rPrChange>` snapshot's inner
 * `<w:rPr>`. Keeps the property-emit logic in one place.
 */
function rprChildElements(props: RunProperties): string[] {
  const parts: string[] = [];
  if (props.styleId) parts.push(el("w:rStyle", { "w:val": props.styleId }));
  if (props.bold) parts.push(el("w:b"));
  if (props.italic) parts.push(el("w:i"));
  if (props.strike) parts.push(el("w:strike"));
  if (props.doubleStrike) parts.push(el("w:dstrike"));
  if (props.underline && props.underline !== "none") {
    parts.push(el("w:u", { "w:val": props.underline }));
  }
  if (props.color) {
    parts.push(el("w:color", { "w:val": stripHash(props.color) }));
  }
  if (props.highlight) {
    parts.push(el("w:highlight", { "w:val": cssHighlightToWord(props.highlight) }));
  }
  if (props.fontFamily) {
    parts.push(
      el("w:rFonts", {
        "w:ascii": props.fontFamily,
        "w:hAnsi": props.fontFamily,
        "w:cs": props.fontFamily,
      }),
    );
  }
  if (props.fontSizePt) {
    const hp = ptToHalfPt(props.fontSizePt);
    parts.push(el("w:sz", { "w:val": hp }));
    parts.push(el("w:szCs", { "w:val": hp }));
  }
  if (props.verticalAlign) {
    parts.push(el("w:vertAlign", { "w:val": props.verticalAlign }));
  }
  if (props.caps) parts.push(el("w:caps"));
  if (props.smallCaps) parts.push(el("w:smallCaps"));
  if (props.hidden) parts.push(el("w:vanish"));
  return parts;
}

function stripHash(s: string): string {
  return s.replace(/^#/, "");
}

function cssHighlightToWord(css: string): string {
  const v = css.trim().toLowerCase();
  const hex = v.startsWith("#") ? v : null;
  const knownByHex: Record<string, string> = {
    "#ffff00": "yellow",
    "#00ff00": "green",
    "#00ffff": "cyan",
    "#ff00ff": "magenta",
    "#0000ff": "blue",
    "#ff0000": "red",
    "#fff3a1": "yellow",
  };
  if (hex && knownByHex[hex]) return knownByHex[hex];
  if (["yellow", "green", "cyan", "magenta", "blue", "red"].includes(v)) return v;
  return "yellow";
}
