/**
 * Loader + flattener for Sobree's `.snapshot.json` files.
 *
 * The oracle test writes these with `toMatchFileSnapshot`, which uses
 * vitest's pretty-printer — JSON-ish but with trailing commas and
 * unquoted property names. We round-trip through a tolerant evaluator
 * (`new Function`) since `JSON.parse` rejects it.
 *
 * Output is a flat `SnapshotBlock[]` — one entry per visual block, in
 * document order. Containers (OL/UL/TABLE) recurse so each LI / cell
 * becomes its own comparable unit.
 */

import { readFileSync } from "node:fs";

export interface SnapshotBlock {
  /** Index in document order (post-flattening). */
  index: number;
  tag: string;
  text: string;
  /** Parsed CSS `font-size` in pt, if declared. */
  fontSizePt: number | null;
  /**
   * Parsed CSS `line-height`. Numeric multiplier when unitless;
   * "normal" when the snapshot recorded `line-height: normal`; null
   * when no `line-height` was declared.
   */
  lineHeight: number | "normal" | null;
}

interface RawBlock {
  tag: string;
  text?: string;
  style?: string;
  attrs?: Record<string, string>;
  children?: RawBlock[];
}

interface RawSnapshot {
  fixture: string;
  blocks: RawBlock[];
}

export function loadSnapshot(path: string): SnapshotBlock[] {
  const raw = readFileSync(path, "utf8");
  // vitest's pretty-print is a JS object literal, not strict JSON.
  // It *also* doesn't escape inner double-quotes inside string values
  // — `font-family: Calibri, "Helvetica Neue", …` lands in the file
  // with the inner `"` literally, breaking both JSON.parse and
  // `new Function`. We re-escape them before evaluating.
  //
  // `new Function` evaluates it in a fresh scope — safe because the
  // input is local and we only use this in a dev tool.
  const cleaned = escapeInnerQuotes(raw);
  // eslint-disable-next-line no-new-func
  const data = new Function(`return (${cleaned});`)() as RawSnapshot;
  const out: SnapshotBlock[] = [];
  for (const block of data.blocks) flatten(block, out);
  return out;
}

/**
 * Walk the snapshot text character-by-character and escape any `"`
 * that appears *inside* a string literal. A string literal is opened
 * by a `"` that follows `:` (key→value boundary in object literals);
 * it closes on the next `"` that's followed by one of `,`, `}`, `]`,
 * or `\n` (with optional whitespace between). Anything else inside is
 * treated as part of the string.
 *
 * The format pretty-format emits is regular enough that this works:
 * every value-position string ends on `",\n` or `"\n` (no trailing
 * commas on the last value), and key-position strings never contain
 * quotes (they're always normal identifiers).
 */
function escapeInnerQuotes(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    out += ch;
    if (ch === ":" && nextNonSpace(text, i + 1) === '"') {
      // Step to the opening quote.
      const openIdx = skipSpaces(text, i + 1);
      out += text.slice(i + 1, openIdx + 1); // include any spaces + the opening "
      i = openIdx + 1;
      // Walk forward, escaping any `"` that isn't the terminator.
      while (i < text.length) {
        const c = text[i]!;
        if (c === "\\" && i + 1 < text.length) {
          out += c + text[i + 1];
          i += 2;
          continue;
        }
        if (c === '"' && isStringTerminator(text, i + 1)) {
          out += '"';
          i++;
          break;
        }
        if (c === '"') {
          out += '\\"';
          i++;
          continue;
        }
        out += c;
        i++;
      }
      continue;
    }
    i++;
  }
  return out;
}

function nextNonSpace(text: string, from: number): string {
  const idx = skipSpaces(text, from);
  return text[idx] ?? "";
}

function skipSpaces(text: string, from: number): number {
  while (from < text.length && (text[from] === " " || text[from] === "\t")) from++;
  return from;
}

function isStringTerminator(text: string, from: number): boolean {
  // pretty-format always emits each value on its own line, so the real
  // string-closing `"` is the one immediately followed by `,\n`,
  // `\n`, `,)` (in array/object close), or the end of file. An inner
  // `"` followed by `, more-text` is NOT a terminator — that would be
  // a comma-with-content continuation inside the string.
  const c0 = text[from];
  if (c0 === undefined) return true;
  if (c0 === "\n") return true;
  if (c0 === "," && text[from + 1] === "\n") return true;
  return false;
}

function flatten(block: RawBlock, out: SnapshotBlock[]): void {
  // Pure containers — recurse into children without emitting a block
  // for the container itself. Including TD/TH so the unit of
  // comparison is the cell's inner `<p>` (whose inline style carries
  // the font + line-height we want to compare); the TD/TH layer has
  // no typography of its own.
  if (CONTAINER_TAGS.has(block.tag)) {
    for (const child of block.children ?? []) flatten(child, out);
    return;
  }
  out.push(parseBlock(block, out.length));
  for (const child of block.children ?? []) flatten(child, out);
}

const CONTAINER_TAGS = new Set(["OL", "UL", "TABLE", "TBODY", "THEAD", "TR", "TD", "TH"]);

function parseBlock(block: RawBlock, index: number): SnapshotBlock {
  const style = block.style ?? "";
  return {
    index,
    tag: block.tag,
    text: block.text ?? "",
    fontSizePt: parseFontSize(style),
    lineHeight: parseLineHeight(style),
  };
}

function parseFontSize(style: string): number | null {
  const m = /font-size:\s*([\d.]+)pt/i.exec(style);
  return m ? Number(m[1]) : null;
}

function parseLineHeight(style: string): number | "normal" | null {
  const m = /line-height:\s*([^;]+)/i.exec(style);
  if (!m) return null;
  const v = m[1]!.trim();
  if (v === "normal") return "normal";
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
