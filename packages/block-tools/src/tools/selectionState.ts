/**
 * Shared "what does the current selection look like?" reader.
 *
 * Tools wire `editor.on("selection", …)` + `editor.on("change", …)` and
 * call `readSelectionState(editor)` to get a snapshot they can use to
 * paint their pressed/active/value state. Everything goes through the
 * public Editor API — no internal access.
 */

import type {
  Block,
  Editor,
  ParagraphProperties,
  RunProperties,
  SobreeDocument,
  TextRun,
  InlineRun,
  Paragraph,
} from "@sobree/core";
import { resolveStyleCascade } from "@sobree/core";

export interface SelectionState {
  /** Block kind under the caret (or `null` when focus is outside).
   *  Derived from `Block["kind"]` so new block kinds never silently
   *  drift this type out of sync. */
  blockKind: Block["kind"] | null;
  /** Paragraph properties of the active block (`null` for non-paragraphs). */
  paragraphProps: ParagraphProperties | null;
  /** Numbering format of the active block, when it's a list item. */
  listFormat: "bullet" | "decimal" | null;
  /**
   * Dominant run-level properties at the caret / range. For a range
   * selection: a property is included only if every text run in the
   * range agrees on it; otherwise it's omitted (=> "mixed", select
   * shows blank). For a caret: properties of the run on the left of
   * the caret (Word-style — the formatting that the next typed char
   * inherits).
   */
  runProps: RunProperties;
}

const EMPTY_STATE: SelectionState = {
  blockKind: null,
  paragraphProps: null,
  listFormat: null,
  runProps: {},
};

export function readSelectionState(editor: Editor): SelectionState {
  const caret = editor.selection.currentCaret();
  if (!caret) return EMPTY_STATE;
  const doc = editor.getDocument();
  const info = editor.getBlockById(caret.block.id);
  if (!info) return EMPTY_STATE;
  const block = doc.body[info.index];
  if (!block) return EMPTY_STATE;
  if (block.kind !== "paragraph") {
    return {
      ...EMPTY_STATE,
      blockKind: block.kind,
    };
  }
  const ownRunProps = resolveRunProps(editor, block);
  // Style cascade is resolved in @sobree/core and reused here so the
  // toolbar's "what's the effective font?" answer is identical to what
  // the renderer applies to the block element.
  const { runDefaults } = resolveStyleCascade(doc.styles, block.properties.styleId);
  return {
    blockKind: "paragraph",
    paragraphProps: block.properties,
    listFormat: resolveListFormat(doc, block),
    runProps: { ...runDefaults, ...ownRunProps },
  };
}

function resolveListFormat(doc: SobreeDocument, p: Paragraph): "bullet" | "decimal" | null {
  const numbering = p.properties.numbering;
  if (!numbering) return null;
  const def = doc.numbering.find((n) => n.numId === numbering.numId);
  const fmt = def?.abstractFormat.levels[0]?.format;
  if (fmt === "bullet" || fmt === "decimal") return fmt;
  return null;
}

function resolveRunProps(editor: Editor, p: Paragraph): RunProperties {
  const range = editor.selection.currentRange();
  if (range && range.from.block.id === range.to.block.id) {
    // Range inside this paragraph — collect every text run that touches
    // the range and intersect their props.
    const lo = Math.min(range.from.offset, range.to.offset);
    const hi = Math.max(range.from.offset, range.to.offset);
    const touched = textRunsInRange(p.runs, lo, hi);
    if (touched.length === 0) return {};
    return intersectProps(touched.map((r) => r.properties));
  }
  // Caret: the run immediately to the left of the offset wins (or, at
  // offset 0, the first run). Matches Word — the format that newly
  // typed characters will inherit.
  const caret = editor.selection.currentCaret();
  if (!caret) return {};
  return runPropsAtOffset(p.runs, caret.offset);
}

/** Walk a paragraph's runs and return every TextRun whose extent
 *  overlaps `[lo, hi)`. Hyperlink children are flattened. */
function textRunsInRange(
  runs: readonly InlineRun[],
  lo: number,
  hi: number,
): TextRun[] {
  const out: TextRun[] = [];
  let cursor = 0;
  walk(runs);
  return out;

  function walk(list: readonly InlineRun[]): void {
    for (const r of list) {
      const start = cursor;
      const len = runLen(r);
      const end = start + len;
      cursor = end;
      if (end <= lo) continue;
      if (start >= hi) return;
      if (r.kind === "text") out.push(r);
      else if (r.kind === "hyperlink") {
        // Hyperlink children own their own textual extent — but `cursor`
        // already moved past the whole hyperlink span. Restore so the
        // recursion's offsets line up with the outer document order.
        cursor = start;
        walk(r.children);
        cursor = end;
      }
    }
  }
}

function runPropsAtOffset(
  runs: readonly InlineRun[],
  offset: number,
): RunProperties {
  let cursor = 0;
  let lastTextProps: RunProperties = {};
  for (const r of runs) {
    const len = runLen(r);
    if (r.kind === "text") lastTextProps = r.properties;
    else if (r.kind === "hyperlink") {
      const inner = lastTextRunProps(r.children);
      if (inner) lastTextProps = inner;
    }
    if (offset > cursor && offset <= cursor + len) {
      return r.kind === "text" ? r.properties : lastTextProps;
    }
    cursor += len;
  }
  return lastTextProps;
}

function lastTextRunProps(runs: readonly InlineRun[]): RunProperties | null {
  let last: RunProperties | null = null;
  for (const r of runs) {
    if (r.kind === "text") last = r.properties;
    else if (r.kind === "hyperlink") {
      const inner = lastTextRunProps(r.children);
      if (inner) last = inner;
    }
  }
  return last;
}

function runLen(r: InlineRun): number {
  if (r.kind === "text") return r.text.length;
  if (r.kind === "hyperlink") {
    let n = 0;
    for (const inner of r.children) n += runLen(inner);
    return n;
  }
  // Atomic single-cell runs (break, tab, field, drawing).
  return 1;
}

/**
 * Return only the properties that EVERY input snapshot agrees on. A
 * key shared by all snapshots with the same value survives; anything
 * that differs (or is missing in some snapshots) is dropped.
 */
function intersectProps(snapshots: ReadonlyArray<RunProperties>): RunProperties {
  if (snapshots.length === 0) return {};
  const first = snapshots[0]!;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(first)) {
    if (v === undefined) continue;
    let agree = true;
    for (let i = 1; i < snapshots.length; i++) {
      if ((snapshots[i] as Record<string, unknown>)[k] !== v) {
        agree = false;
        break;
      }
    }
    if (agree) out[k] = v;
  }
  return out as RunProperties;
}
