import type {
  Block,
  NumberingDefinition,
  Paragraph,
  ParagraphProperties,
} from "../../../doc/types";
import { mergeStyleAttribute, serializeInlineChildren } from "./inline";
import { tableFromElement } from "./table";

export interface BlockSerializeContext {
  /** Accumulated numbering definitions, one per encountered list. */
  numbering: NumberingDefinition[];
  /**
   * Allocated numId for the CURRENT list stream. Reset to `null` by the
   * caller between lists.
   */
  currentList: { numId: number; ordered: boolean } | null;
  /**
   * Running count of section breaks seen so far (across all hosts). The Nth
   * section break transitions to section N — matching the renderer's
   * order-based section assignment — so the count IS the break's
   * `toSectionIndex`. Reconstructing it is load-bearing: the renderer reads
   * a break's page-break-vs-continuous behaviour from `sections[toSectionIndex]`,
   * so a wrong index (e.g. a hardcoded 0) makes a continuous break re-render
   * as a forced page break, exploding the layout on the next re-render
   * (undo/redo/remote).
   */
  sectionBreaks: number;
  /**
   * Capture each paragraph's effective base run style (from the rendered
   * `<p>`'s inline font) into `ParagraphProperties.runDefaults`.
   *
   * Used for textbox-frame read-back only. A frame's text carries its font
   * on the runs, with no named style to fall back on; so when a keystroke
   * lands in a bare text node — or a select-all-retype replaces every
   * styled span with one unstyled node — the runs lose their font and a
   * repaint renders the whole line at the default tiny size. The `<p>`
   * element keeps its inline font through these DOM edits, so promoting it
   * to a paragraph-level default makes the font survive run-level loss.
   * Body flow leaves this off: its runs legitimately inherit from named
   * styles, which must stay style-linked across edits.
   */
  captureRunDefaults?: boolean;
  /**
   * Optional sink for each emitted block's source DOM element (or `null`
   * for a bare text node), kept strictly parallel to the returned blocks.
   * The editor reads each element's stable `data-block-id` to match a
   * re-read block back to its previous AST block — so block-level
   * properties (spacing, table style, …) survive a read-back across plain
   * typing AND structural edits, where positional matching can't. Left
   * unset for callers that don't need provenance (frame read-back, tests).
   */
  sources?: (HTMLElement | null)[];
}

export function blocksFromNodes(nodes: readonly Node[], ctx: BlockSerializeContext): Block[] {
  const out: Block[] = [];
  // Emit a block AND record its source element in lock-step, so the
  // `ctx.sources` sink can never drift out of alignment with `out`. The
  // column-unwrap recursion below appends to the same `ctx.sources` via its
  // own emits, then spreads its returned blocks here — order is preserved.
  const emit = (block: Block, source: HTMLElement | null) => {
    out.push(block);
    ctx.sources?.push(source);
  };
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text.trim() === "") continue;
      emit(
        { kind: "paragraph", properties: {}, runs: [{ kind: "text", text, properties: {} }] },
        null,
      );
      continue;
    }
    if (!(node instanceof HTMLElement)) continue;

    // Section break — recognise the renderer's marker class and emit a
    // real `SectionBreak` block. Must come BEFORE the
    // `contenteditable="false"` skip below, since the marker is also
    // contenteditable=false but carries semantic meaning.
    if (node.classList.contains("sobree-section-break")) {
      ctx.sectionBreaks += 1;
      emit({ kind: "section_break", toSectionIndex: ctx.sectionBreaks }, node);
      ctx.currentList = null;
      continue;
    }

    // Multi-column section wrapper — a pure LAYOUT artifact. `flowColumnSections`
    // restructures a multi-column section's blocks into `.sobree-col` tracks
    // (chunked per page) for the snaking layout; the AST has no such wrapper
    // (just a flat block list + the section's column property). So the readback
    // must UN-WRAP it, the exact inverse of the render-side wrap: recurse into
    // each track's children in DOM order — which is document order, since
    // blocks move WHOLE into tracks, never split (see `columnFlow.ts`). Without
    // this the whole wrapper serialises as one merged paragraph, collapsing the
    // section's paragraphs and destroying its content on the first edit.
    if (node.classList.contains("sobree-cols")) {
      const tracks = Array.from(node.querySelectorAll<HTMLElement>(":scope > .sobree-col"));
      const trackSources = tracks.length > 0 ? tracks : [node];
      for (const src of trackSources) {
        // Recurse with the same ctx so the inner emits append to `ctx.sources`
        // in document order; spread the returned blocks into `out` to match.
        out.push(...blocksFromNodes(Array.from(src.childNodes), ctx));
      }
      continue;
    }

    if (node.getAttribute("contenteditable") === "false") continue;

    const tag = node.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") {
      // Allocate a fresh numId for this list's run.
      const numId = ctx.numbering.length + 1;
      const ordered = tag === "ol";
      ctx.numbering.push({
        numId,
        abstractFormat: {
          levels: [
            { level: 0, format: ordered ? "decimal" : "bullet", text: ordered ? "%1." : "\u2022" },
          ],
        },
      });
      for (const li of Array.from(node.querySelectorAll(":scope > li"))) {
        if (!(li instanceof HTMLElement)) continue;
        const paragraph: Paragraph = {
          kind: "paragraph",
          properties: { numbering: { numId, level: 0 } },
          runs: serializeInlineChildren(li),
        };
        if (ctx.captureRunDefaults) applyRunDefaults(paragraph.properties, li);
        emit(paragraph, li);
      }
      ctx.currentList = null;
      continue;
    }

    ctx.currentList = null;

    if (tag === "table") {
      emit(tableFromElement(node), node);
      continue;
    }

    if (tag === "hr" || node.hasAttribute("data-page-break")) {
      emit(
        {
          kind: "paragraph",
          properties: {
            borders: {
              bottom: { style: "single", sizeEighthsOfPt: 6, color: "auto", spaceTwips: 1 },
            },
          },
          runs: [],
        },
        node,
      );
      continue;
    }

    if (tag === "blockquote") {
      // Render each inner paragraph as a Quote-styled paragraph.
      for (const child of Array.from(node.children)) {
        if (!(child instanceof HTMLElement)) continue;
        const para = paragraphFromElement(child, "Quote");
        if (para) {
          if (ctx.captureRunDefaults) applyRunDefaults(para.properties, child);
          emit(para, child);
        }
      }
      continue;
    }

    const para = paragraphFromElement(node);
    if (para) {
      if (ctx.captureRunDefaults) applyRunDefaults(para.properties, node);
      emit(para, node);
    }
  }
  return out;
}

function paragraphFromElement(el: HTMLElement, forcedStyleId?: string): Paragraph | null {
  const tag = el.tagName.toLowerCase();
  const properties: ParagraphProperties = {};

  if (forcedStyleId) {
    properties.styleId = forcedStyleId;
  } else {
    const m = tag.match(/^h([1-6])$/);
    if (m) properties.styleId = `Heading${m[1]}`;
  }

  const align = el.style.textAlign;
  if (align === "left" || align === "right" || align === "center") {
    properties.alignment = align;
  } else if (align === "justify") {
    properties.alignment = "both";
  }

  const lineHeight = el.style.lineHeight;
  if (lineHeight) {
    const n = Number(lineHeight);
    if (Number.isFinite(n) && n > 0) {
      properties.spacing = { line: Math.round(240 * n), lineRule: "auto" };
    }
  }

  // `data-style-id` carries the Word style id verbatim (set by the
  // renderer) — feed it straight back, no case / space mangling.
  const dataStyleId = el.getAttribute("data-style-id");
  if (dataStyleId && !properties.styleId) {
    properties.styleId = dataStyleId;
  }

  return {
    kind: "paragraph",
    properties,
    runs: serializeInlineChildren(el),
  };
}

/**
 * Promote a paragraph's rendered base run style (the `<p>`'s own inline
 * font, set by the renderer's dominant-run cascade) to
 * `ParagraphProperties.runDefaults`, so the font survives even when every
 * run loses its inline styling. See `BlockSerializeContext.captureRunDefaults`.
 *
 * The `<p>`'s inline style also carries paragraph-level declarations
 * (line-height, text-align, margins); `mergeStyleAttribute` reads only the
 * run-relevant ones (font-family, font-size, colour, weight, …) and drops
 * the rest. Skip when nothing run-relevant is present so unstyled
 * paragraphs stay clean.
 */
function applyRunDefaults(properties: ParagraphProperties, el: HTMLElement): void {
  const runProps = mergeStyleAttribute({}, el.getAttribute("style"));
  if (Object.keys(runProps).length > 0) properties.runDefaults = runProps;
}
