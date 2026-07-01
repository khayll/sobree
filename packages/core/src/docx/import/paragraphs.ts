import { NS } from "../shared/namespaces";
import { readShading } from "../shared/shading";
import { ooxmlLineHeightToCss } from "../shared/units";
import { wChildren, wFirst, wVal } from "../shared/xml";
import type { ParagraphFormat } from "../types";
import { readParagraphBorders } from "./borders";
import { readRunProperties } from "./runProperties";
import { type ImportedRun, readRun } from "./runs";

/** Source-order paragraph item: either a flat run or a hyperlink-wrapped group. */
export type ImportedItem =
  | { kind: "run"; run: ImportedRun }
  /** `href` is set for HYPERLINK *fields* (the target lives in the field
   *  instruction); `relId` for `<w:hyperlink r:id>` elements (resolved
   *  against the rels table downstream). */
  | { kind: "hyperlink"; relId?: string; href?: string; runs: ImportedRun[] };

export interface ImportedParagraph {
  /** Items in document order. Hyperlinks contain inner runs. */
  items: ImportedItem[];
  format: ParagraphFormat;
}

/**
 * Read a single `<w:p>` into an `ImportedParagraph`.
 *
 * `activeComments` is an *external* set the caller threads across
 * paragraphs so comment ranges (`<w:commentRangeStart/End>`) that span
 * multiple paragraphs tag the middle paragraphs' runs too. When
 * omitted, a fresh empty set is used — fine for contexts where ranges
 * shouldn't cross the paragraph (footnote bodies, comment bodies,
 * table cells).
 */
export function readParagraph(
  p: Element,
  activeComments: Set<number> = new Set(),
): ImportedParagraph {
  const items: ImportedItem[] = [];
  collectParagraphChildren(p, items, undefined, activeComments);
  const pPr = wFirst(p, "pPr");
  const format = pPr ? readParagraphFormat(pPr) : {};
  return { items, format };
}

/**
 * Walk a `<w:p>`'s direct children, expanding `<w:ins>` / `<w:del>`
 * wrappers in-place and tagging their inner runs with revision /
 * comment markers so the renderer can apply tracked-change styling
 * and comment highlighting.
 *
 * `revision` is the marker inherited from an enclosing `<w:ins>` /
 * `<w:del>` — undefined at the top level. Nested wrappers (rare; e.g.
 * a deletion inside an insertion) take the *inner* marker since that's
 * the more specific revision.
 *
 * `activeComments` is a running set of comment ids whose
 * `<w:commentRangeStart>` we've seen but whose `<w:commentRangeEnd>`
 * we haven't. Every run pushed while the set is non-empty gets tagged
 * with a snapshot of the active ids. NOTE: ranges that cross paragraph
 * boundaries aren't yet supported — the caller resets `activeComments`
 * per paragraph, so a comment opened in para N and closed in para M>N
 * highlights only its portion in para N. Most comments target a short
 * phrase within one paragraph, so the loss is small for now.
 */
function collectParagraphChildren(
  container: Element,
  out: ImportedItem[],
  revision: ImportedRun["revision"],
  activeComments: Set<number>,
): void {
  // Complex-field state tracking. Word writes PAGE/NUMPAGES fields as:
  //
  //   <w:r><w:fldChar w:fldCharType="begin"/></w:r>
  //   <w:r><w:instrText> PAGE </w:instrText></w:r>
  //   <w:r><w:fldChar w:fldCharType="separate"/></w:r>
  //   <w:r><w:t>1</w:t></w:r>   ← cached display value
  //   <w:r><w:fldChar w:fldCharType="end"/></w:r>
  //
  // We swallow everything between `begin` and `end`, accumulate the
  // instruction text + cached value, then emit ONE FieldRun. Without
  // this, the footer in complex-multipage.docx shows "Page 1 of 16"
  // baked into every page (the source's cached value) instead of the
  // live per-paper substitution `<span class="sobree-field">` enables.
  let fieldState: "before" | "code" | "result" = "before";
  let fieldInstr = "";
  let fieldCached = "";
  let fieldResultRuns: ImportedRun[] = [];

  const flushField = () => {
    if (fieldState === "before") return;
    const instruction = fieldInstr.trim();
    // A HYPERLINK field IS a hyperlink — same semantics as
    // `<w:hyperlink r:id>`, just with the target in the instruction and
    // the link text in the RESULT runs. Normalise it to a hyperlink item
    // so the link renders as an anchor with the result runs' own
    // formatting (their rStyle gives Word's underline/colour). Collapsing
    // it to a FieldRun (the PAGE/NUMPAGES shape) discarded all of that —
    // links rendered as unstyled plain text.
    const href = parseHyperlinkInstruction(instruction);
    if (href !== null && fieldResultRuns.length > 0) {
      out.push({ kind: "hyperlink", href, runs: fieldResultRuns });
    } else {
      const run: ImportedRun = {
        text: "",
        format: {},
        isHardBreak: false,
        field: fieldCached !== "" ? { instruction, cached: fieldCached } : { instruction },
      };
      if (revision) run.revision = revision;
      if (activeComments.size > 0) run.commentIds = Array.from(activeComments);
      out.push({ kind: "run", run });
    }
    fieldState = "before";
    fieldInstr = "";
    fieldCached = "";
    fieldResultRuns = [];
  };

  for (const child of Array.from(container.children)) {
    if (child.namespaceURI !== NS.w) continue;
    if (child.localName === "r") {
      // Probe for field-char boundary / instrText inside this run.
      const fldChar = wFirst(child, "fldChar");
      const instrText = wFirst(child, "instrText");
      if (fldChar) {
        const type =
          fldChar.getAttributeNS(NS.w, "fldCharType") ?? fldChar.getAttribute("w:fldCharType");
        if (type === "begin") {
          // Flush any previously-open malformed field first.
          flushField();
          fieldState = "code";
          continue;
        }
        if (type === "separate") {
          fieldState = "result";
          continue;
        }
        if (type === "end") {
          flushField();
          continue;
        }
      }
      if (instrText && fieldState === "code") {
        fieldInstr += instrText.textContent ?? "";
        continue;
      }
      if (fieldState === "result") {
        // Accumulate the cached display text (the renderer substitutes
        // PAGE/NUMPAGES live from `field.instruction`) AND keep the
        // fully-read result runs — a HYPERLINK field's flush emits them
        // as the link's children, formatting intact.
        const t = wFirst(child, "t");
        if (t) fieldCached += t.textContent ?? "";
        const resultRun = readRun(child);
        if (revision) resultRun.revision = revision;
        if (activeComments.size > 0) resultRun.commentIds = Array.from(activeComments);
        fieldResultRuns.push(resultRun);
        continue;
      }
      if (fieldState === "code") {
        // Inside the instruction zone — instructions can split across
        // runs (Word sometimes adds a stray empty run). Skip non-
        // instrText runs to keep the field together.
        continue;
      }
      const run = readRun(child);
      if (revision) run.revision = revision;
      if (activeComments.size > 0) run.commentIds = Array.from(activeComments);
      out.push({ kind: "run", run });
    } else if (child.localName === "hyperlink") {
      const relId = child.getAttributeNS(NS.r, "id") ?? child.getAttribute("r:id") ?? undefined;
      const runs = wChildren(child, "r").map((r) => {
        const run = readRun(r);
        if (revision) run.revision = revision;
        if (activeComments.size > 0) run.commentIds = Array.from(activeComments);
        return run;
      });
      out.push({ kind: "hyperlink", ...(relId ? { relId } : {}), runs });
    } else if (child.localName === "sdt") {
      // Run-level content control (`<w:sdt>` INSIDE a paragraph — e.g.
      // a cover-page "E-mail Address" binding). The block-level SDT
      // expander never sees these; without recursing into the
      // sdtContent, every run inside the control silently vanishes.
      const sdtContent = wFirst(child, "sdtContent");
      if (sdtContent) {
        collectParagraphChildren(sdtContent, out, revision, activeComments);
      }
    } else if (child.localName === "ins" || child.localName === "del") {
      const nextRevision: ImportedRun["revision"] = {
        type: child.localName === "ins" ? "ins" : "del",
        ...readRevisionAttrs(child),
      };
      collectParagraphChildren(child, out, nextRevision, activeComments);
    } else if (child.localName === "commentRangeStart") {
      const id = readCommentId(child);
      if (id !== null) activeComments.add(id);
    } else if (child.localName === "commentRangeEnd") {
      const id = readCommentId(child);
      if (id !== null) activeComments.delete(id);
    } else if (child.localName === "fldSimple") {
      // Simple field — `<w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple>`
      // Emit one `ImportedRun` with `field` set so the paragraph
      // converter produces a `FieldRun`. Used by headers/footers to
      // carry page-number tokens through round-trip.
      const instr = child.getAttributeNS(NS.w, "instr") ?? child.getAttribute("w:instr") ?? "";
      const innerR = wFirst(child, "r");
      const cachedText = innerR ? (wFirst(innerR, "t")?.textContent ?? "") : "";
      const run: ImportedRun = {
        text: "",
        format: {},
        isHardBreak: false,
        field:
          cachedText !== "" ? { instruction: instr, cached: cachedText } : { instruction: instr },
      };
      if (revision) run.revision = revision;
      if (activeComments.size > 0) run.commentIds = Array.from(activeComments);
      out.push({ kind: "run", run });
    }
    // pPr / commentReference (the balloon-icon run) handled by the
    // caller or silently dropped — the highlighted range carries the
    // visual signal, so the reference glyph is redundant.
  }
}

/**
 * Extract the target of a `HYPERLINK` field instruction, or `null` when
 * the instruction is some other field.
 *
 *   HYPERLINK "https://x.y"            → https://x.y
 *   HYPERLINK \l "bookmark"            → #bookmark
 *   HYPERLINK "https://x.y" \l "frag"  → https://x.y#frag
 *
 * Switches like `\o "tooltip"` are ignored. (ECMA-376 §17.16.5.25.)
 */
function parseHyperlinkInstruction(instruction: string): string | null {
  if (!/^\s*HYPERLINK\b/i.test(instruction)) return null;
  const rest = instruction.replace(/^\s*HYPERLINK\b/i, "");
  const anchor = /\\l\s+"([^"]*)"/.exec(rest);
  // The first quoted string NOT belonging to a switch is the target URL.
  const target = /(?:^|[^\\\w])\s*"([^"]*)"/.exec(rest.replace(/\\\w\s+"[^"]*"/g, ""));
  if (target?.[1]) return anchor?.[1] ? `${target[1]}#${anchor[1]}` : target[1];
  if (anchor?.[1]) return `#${anchor[1]}`;
  return null;
}

function readCommentId(el: Element): number | null {
  const raw = el.getAttributeNS(NS.w, "id") ?? el.getAttribute("w:id");
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read just the font properties (family + size) from a paragraph-mark
 * `<w:rPr>`. These apply to the invisible paragraph mark glyph and
 * are what Word uses to size empty paragraphs — if the paragraph has
 * no inline runs, the mark's font drives the line height.
 *
 * Delegates to the shared `<w:rPr>` reader and keeps only the two
 * height-affecting fields, so the font/size parsing lives in exactly
 * one place.
 */
function readMarkRunFormat(rPr: Element): { fontFamily?: string; fontSizePt?: number } {
  const props = readRunProperties(rPr);
  const out: { fontFamily?: string; fontSizePt?: number } = {};
  if (props?.fontFamily) out.fontFamily = props.fontFamily;
  if (props?.fontSizePt !== undefined) out.fontSizePt = props.fontSizePt;
  return out;
}

function readRevisionAttrs(el: Element): { author?: string; date?: string } {
  const out: { author?: string; date?: string } = {};
  const author = el.getAttributeNS(NS.w, "author") ?? el.getAttribute("w:author");
  if (author) out.author = author;
  const date = el.getAttributeNS(NS.w, "date") ?? el.getAttribute("w:date");
  if (date) out.date = date;
  return out;
}

function readParagraphFormat(pPr: Element): ParagraphFormat {
  const format: ParagraphFormat = {};

  const styleVal = wVal(wFirst(pPr, "pStyle"));
  if (styleVal) {
    // Word's canonical heading style names are `Heading1` ... `Heading6`
    // (also tolerate `heading 1`, OpenOffice's lowercase export). These
    // canonicalise to `HeadingN` so the renderer emits `<hN>`.
    //
    // `Title` is NOT folded in here: it's a distinct Word style with its
    // own formatting (often a larger display font than Heading1), and
    // mapping it to `Heading1` would discard that and re-style it as a
    // heading. Carried through verbatim below, it resolves via its own
    // style cascade like any other named style.
    const m = styleVal.match(/^heading\s*([1-6])$/i);
    if (m) format.headingLevel = Number(m[1]);
    // Always carry the raw styleId through. The renderer uses it as
    // the cascade anchor — `ListParagraph` / `BodyText` / etc. style
    // pPr / rPr would otherwise be silently dropped.
    format.styleId = styleVal;
  }

  const jcVal = wVal(wFirst(pPr, "jc"));
  if (jcVal) {
    if (jcVal === "left" || jcVal === "start") format.alignment = "left";
    else if (jcVal === "right" || jcVal === "end") format.alignment = "right";
    else if (jcVal === "center") format.alignment = "center";
    else if (jcVal === "both" || jcVal === "distribute") format.alignment = "justify";
  }

  const spacing = wFirst(pPr, "spacing");
  if (spacing) {
    const line =
      spacing.getAttributeNS(spacing.namespaceURI, "line") ?? spacing.getAttribute("w:line");
    const rule =
      spacing.getAttributeNS(spacing.namespaceURI, "lineRule") ??
      spacing.getAttribute("w:lineRule");
    if (line && (!rule || rule === "auto")) {
      const n = Number(line);
      if (Number.isFinite(n) && n > 0) format.lineHeight = ooxmlLineHeightToCss(n);
    }
    // `<w:spacing w:before w:after>` — twips of inter-paragraph space.
    // Critical to import: if Word sees a paragraph with explicit
    // `after="0"`, that ZERO must override any DocDefaults-derived
    // afterTwips (200 by default in Word). Without this, the style
    // cascade leaks the DocDefaults' after-space onto every paragraph
    // (jellap.docx form rows would each gain ~13px of bottom margin
    // they didn't ask for, blowing up vertical spacing and
    // pagination). We store the values on `pSpacingBefore` /
    // `pSpacingAfter` so the AST keeps them explicit (including 0).
    const after =
      spacing.getAttributeNS(spacing.namespaceURI, "after") ?? spacing.getAttribute("w:after");
    const before =
      spacing.getAttributeNS(spacing.namespaceURI, "before") ?? spacing.getAttribute("w:before");
    if (after !== null) {
      const n = Number(after);
      if (Number.isFinite(n)) format.spacingAfterTwips = n;
    }
    if (before !== null) {
      const n = Number(before);
      if (Number.isFinite(n)) format.spacingBeforeTwips = n;
    }
  }

  const numPr = wFirst(pPr, "numPr");
  if (numPr) {
    const numId = wVal(wFirst(numPr, "numId"));
    const ilvl = wVal(wFirst(numPr, "ilvl"));
    // `<w:numId w:val="0"/>` is OOXML's explicit "no numbering" sentinel
    // (ECMA-376 §17.9.18): a paragraph uses it to CANCEL a list its
    // style would otherwise inherit. Treat it as un-numbered — not as a
    // real "list 0", which has no definition and would render as a stray
    // ordered-list marker over-printing the text.
    if (numId !== null && Number(numId) !== 0) {
      format.numId = Number(numId);
      if (ilvl !== null) format.numLevel = Number(ilvl);
    }
  }

  // <w:tabs><w:tab w:val="left" w:pos="N"/>…</w:tabs>
  // Custom tab stops in twips, defined per paragraph. Their positions
  // determine where each `<w:tab/>` advances the cursor — critical for
  // Word headers like jellap.docx where "Cím:" + tab lands at column
  // ~30pt for the value. We store the raw stops on the AST; the
  // renderer translates them into CSS (tab-size on the paragraph for
  // even spacing, or absolute positions via inline-block stops for
  // mixed layouts).
  const tabsEl = wFirst(pPr, "tabs");
  if (tabsEl) {
    const stops: { positionTwips: number; alignment: string; leader?: string }[] = [];
    for (const tab of Array.from(tabsEl.children)) {
      if (tab.namespaceURI !== tabsEl.namespaceURI || tab.localName !== "tab") continue;
      const posAttr = tab.getAttributeNS(tab.namespaceURI, "pos") ?? tab.getAttribute("w:pos");
      const valAttr = tab.getAttributeNS(tab.namespaceURI, "val") ?? tab.getAttribute("w:val");
      const leaderAttr =
        tab.getAttributeNS(tab.namespaceURI, "leader") ?? tab.getAttribute("w:leader");
      if (posAttr === null) continue;
      const pos = Number(posAttr);
      if (!Number.isFinite(pos)) continue;
      stops.push({
        positionTwips: pos,
        alignment: valAttr ?? "left",
        ...(leaderAttr ? { leader: leaderAttr } : {}),
      });
    }
    if (stops.length > 0) format.tabStops = stops;
  }

  // <w:ind w:left="..." w:right="..." w:firstLine="..." w:hanging="..."/>
  // Paragraph indentation in twips (1/1440 inch). The renderer applies
  // this via `margin-left`/`margin-right`/`text-indent`. Critical for
  // headers like jellap.docx where the logo paragraph uses `w:left=5812`
  // (~10cm) to push the inline image to the right column, leaving the
  // left half free for an absolutely-positioned text-box of contact info.
  const indEl = wFirst(pPr, "ind");
  if (indEl) {
    const readTwipAttr = (name: string): number | undefined => {
      const raw = indEl.getAttributeNS(indEl.namespaceURI, name) ?? indEl.getAttribute(`w:${name}`);
      if (raw === null) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    };
    const left = readTwipAttr("left") ?? readTwipAttr("start");
    const right = readTwipAttr("right") ?? readTwipAttr("end");
    const firstLine = readTwipAttr("firstLine");
    const hanging = readTwipAttr("hanging");
    if (
      left !== undefined ||
      right !== undefined ||
      firstLine !== undefined ||
      hanging !== undefined
    ) {
      format.indent = {
        ...(left !== undefined ? { leftTwips: left } : {}),
        ...(right !== undefined ? { rightTwips: right } : {}),
        ...(firstLine !== undefined ? { firstLineTwips: firstLine } : {}),
        ...(hanging !== undefined ? { hangingTwips: hanging } : {}),
      };
    }
  }

  // <w:pBdr> — paragraph borders (top / left / bottom / right /
  // between). Each child element specifies style (single / dashed /
  // dotted / double / …), size (in eighths of a point), color, and
  // optional space (in twips). Word uses these for inline rules like
  // a dotted divider under a header line. Without import, the divider
  // never reaches the AST and the renderer's existing
  // `effective.borders.bottom` branch fires only off the style
  // cascade (which doesn't have the divider).
  const borders = readParagraphBorders(pPr);
  if (borders) format.borders = borders;

  // <w:shd w:val="clear" w:fill="…"/> — paragraph background colour.
  const shading = readShading(pPr);
  if (shading) format.shading = shading;

  // Paragraph-mark properties — `<w:pPr><w:rPr>...</w:rPr></w:pPr>`.
  // Carries (a) revision marker for paragraph-break tracking, and
  // (b) font / size / colour defaults that apply to the invisible
  // paragraph-mark AND to empty paragraphs (no inline runs to
  // override). Without (b), empty paragraphs fall back to the browser
  // default 16px font and balloon every form's vertical spacing
  // (jellap.docx has many empty 9pt paragraphs that need to render
  // at 9pt-derived line-height, not 16px-derived).
  const pPr_rPr = wFirst(pPr, "rPr");
  if (pPr_rPr) {
    // Cache the paragraph-mark run properties so the renderer can
    // size empty paragraphs / their paragraph mark correctly. We
    // re-use readRunFormat semantics by inlining a minimal read
    // (just font / size — the only properties that affect height).
    const markFormat = readMarkRunFormat(pPr_rPr);
    if (markFormat.fontFamily || markFormat.fontSizePt !== undefined) {
      format.markFormat = markFormat;
    }
    const insEl = wFirst(pPr_rPr, "ins");
    const delEl = wFirst(pPr_rPr, "del");
    const revEl = insEl ?? delEl;
    if (revEl) {
      const type: "ins" | "del" = insEl ? "ins" : "del";
      const author =
        revEl.getAttributeNS(revEl.namespaceURI, "author") ??
        revEl.getAttribute("w:author") ??
        undefined;
      const date =
        revEl.getAttributeNS(revEl.namespaceURI, "date") ??
        revEl.getAttribute("w:date") ??
        undefined;
      format.revision = {
        type,
        ...(author !== undefined ? { author } : {}),
        ...(date !== undefined ? { date } : {}),
      };
    }
  }

  return format;
}
